//! The webview reaches only explicitly configured loopback model servers.
use futures_util::StreamExt;
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::ipc::Channel;

#[derive(Default)]
pub struct LocalRequests(pub Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>);

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LocalResponse {
    Headers { status: u16 },
    Data { bytes: Vec<u8> },
    Done,
}

fn local_url(value: &str) -> Result<url::Url, String> {
    let mut url = url::Url::parse(value).map_err(|e| e.to_string())?;
    if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some() {
        return Err("Local models require an HTTP loopback URL without credentials".into());
    }
    match url.host_str() {
        Some("localhost") => { url.set_host(Some("127.0.0.1")).map_err(|e| e.to_string())?; }
        Some("127.0.0.1") | Some("[::1]") => {}
        _ => return Err("Local model server must use localhost, 127.0.0.1, or [::1]".into()),
    }
    if !matches!(url.path(), "/v1/models" | "/v1/chat/completions") || url.query().is_some() {
        return Err("Unsupported local model endpoint".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn local_llm_request(
    id: String, url: String, body: Option<serde_json::Value>,
    on_event: Channel<LocalResponse>, requests: tauri::State<'_, LocalRequests>,
) -> Result<(), String> {
    let url = local_url(&url)?;
    if body.is_some() != (url.path() == "/v1/chat/completions") {
        return Err("Invalid local model request method".into());
    }
    let client = reqwest::Client::builder().no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(180))
        .build().map_err(|e| e.to_string())?;
    let (cancel, cancelled) = tokio::sync::oneshot::channel();
    requests.0.lock().map_err(|e| e.to_string())?.insert(id.clone(), cancel);
    let operation = async {
        let request = match body { Some(body) => client.post(url).json(&body), None => client.get(url) };
        let response = request.send().await.map_err(|e| e.to_string())?;
        on_event.send(LocalResponse::Headers { status: response.status().as_u16() }).map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        while let Some(bytes) = stream.next().await {
            on_event.send(LocalResponse::Data { bytes: bytes.map_err(|e| e.to_string())?.to_vec() }).map_err(|e| e.to_string())?;
        }
        on_event.send(LocalResponse::Done).map_err(|e| e.to_string())?;
        Ok(())
    };
    let result = tokio::select! { result = operation => result, _ = cancelled => Err("Request cancelled".into()) };
    requests.0.lock().map_err(|e| e.to_string())?.remove(&id);
    result
}

#[tauri::command]
pub fn local_llm_cancel(id: String, requests: tauri::State<'_, LocalRequests>) {
    if let Ok(mut pending) = requests.0.lock() { pending.remove(&id); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_loopback_model_endpoints() {
        assert_eq!(local_url("http://localhost:11434/v1/models").unwrap().host_str(), Some("127.0.0.1"));
        assert!(local_url("http://[::1]:1234/v1/chat/completions").is_ok());
        for url in ["https://example.com/v1/models", "http://127.0.0.1.evil.com/v1/models", "http://user@localhost/v1/models", "http://localhost/admin", "http://localhost/v1/models?url=remote"] {
            assert!(local_url(url).is_err(), "{url}");
        }
    }
}

//! Dedicated OpenCode Go transport. Credentials never cross back into the webview.
use futures_util::StreamExt;
use serde_json::Value;
use std::time::Duration;
use tauri::ipc::Channel;
use super::local_llm::{LocalRequests, LocalResponse};

const BASE: &str = "https://opencode.ai/zen/go/v1";
pub const KEY: &str = "lazygt.apikey.opencode-go";
pub const KEY_PREFIX: &str = "lazygt.apikey.opencode-go.";

fn valid_key_id(key_id: &str) -> bool {
    key_id == "legacy" || (!key_id.is_empty() && key_id.len() <= 80 && key_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
}

fn vault_key_for(key_id: Option<&str>) -> Result<String, String> {
    match key_id.filter(|id| !id.trim().is_empty()).unwrap_or("legacy") {
        "legacy" => Ok(KEY.to_string()),
        id if valid_key_id(id) => Ok(format!("{KEY_PREFIX}{id}")),
        _ => Err("Invalid OpenCode Go key selection".into()),
    }
}

fn valid_endpoint(endpoint: &str, has_body: bool) -> bool {
    matches!((endpoint, has_body), ("models", false) | ("chat/completions", true) | ("messages", true) | ("responses", true))
}

#[tauri::command]
pub async fn opencode_go_request(
    id: String, endpoint: String, session: String, key_id: Option<String>, body: Option<Value>,
    on_event: Channel<LocalResponse>, requests: tauri::State<'_, LocalRequests>,
) -> Result<(), String> {
    if !valid_endpoint(&endpoint, body.is_some()) { return Err("Unsupported OpenCode Go endpoint".into()); }
    if session.is_empty() || session.len() > 160 || !session.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("Invalid conversation identifier".into());
    }
    let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .user_agent("lazygt/0.1.19").connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(900)).build().map_err(|_| "Could not initialize Go transport")?;
    let mut request = if body.is_some() { client.post(format!("{BASE}/{endpoint}")) } else { client.get(format!("{BASE}/{endpoint}")) };
    request = request.header("x-opencode-session", session);
    if let Some(body) = body {
        let vault_key = vault_key_for(key_id.as_deref())?;
        let key = super::vault::vault_get(&vault_key)?.filter(|k| !k.trim().is_empty()).ok_or("Add your OpenCode Go key in Settings > Models")?;
        request = request.bearer_auth(&key).header("x-api-key", &key).header("anthropic-version", "2023-06-01").json(&body);
    }
    let (cancel, cancelled) = tokio::sync::oneshot::channel();
    requests.0.lock().map_err(|_| "Request state unavailable")?.insert(id.clone(), cancel);
    let operation = async {
        let response = request.send().await.map_err(|_| "OpenCode Go connection failed or timed out")?;
        let status = response.status();
        if !status.is_success() {
            let code = status.as_u16();
            let detail = response.text().await.unwrap_or_default();
            let detail = detail.chars().take(500).collect::<String>();
            return Err(match code {
                401 | 403 => "OpenCode Go rejected the key or subscription. Check your Go key and account access.".to_string(),
                429 => "OpenCode Go usage limit reached. Check your subscription usage or try another included model.".to_string(),
                _ if detail.trim().is_empty() => format!("OpenCode Go returned HTTP {}. Try another model or retry later.", code),
                _ => format!("OpenCode Go returned HTTP {}: {}", code, detail),
            });
        }
        on_event.send(LocalResponse::Headers { status: status.as_u16() }).map_err(|_| "Response channel closed")?;
        let mut stream = response.bytes_stream();
        while let Some(bytes) = stream.next().await {
            on_event.send(LocalResponse::Data { bytes: bytes.map_err(|_| "OpenCode Go stream interrupted")?.to_vec() }).map_err(|_| "Response channel closed")?;
        }
        on_event.send(LocalResponse::Done).map_err(|_| "Response channel closed")?;
        Ok(())
    };
    let result = tokio::select! { result = operation => result, _ = cancelled => Err("Request cancelled".into()) };
    requests.0.lock().map_err(|_| "Request state unavailable")?.remove(&id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoint_allowlist() {
        assert!(valid_endpoint("models", false));
        for endpoint in ["messages", "responses", "chat/completions"] { assert!(valid_endpoint(endpoint, true)); }
        for endpoint in ["https://evil.test", "../models", "models?key=x", "models"] { assert!(!valid_endpoint(endpoint, true)); }
        assert!(!valid_endpoint("responses", false));
        assert!(valid_key_id("legacy"));
        assert!(valid_key_id("go_abc-123"));
        assert!(!valid_key_id("../bad"));
    }
}

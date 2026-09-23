import { emit } from '../lib/bus';
export function AccountChip() {
 return <button onClick={() => emit('nav:navigateSpace', 'settings')} title="Configure AI engines" style={{background:'transparent',border:'1px solid var(--color-border)',borderRadius:6,color:'var(--color-text)',padding:'5px 10px'}}>lazygt · Engines</button>;
}

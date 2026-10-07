import { Server } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Input, Notice } from '../components/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [serverResult, setServerResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void window.bcis.config.get().then((c) => setServerUrl(c.serverUrl));
    void window.bcis.app.info().then((i) => setVersion(i.version));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await login(username.trim(), password));
    setPassword('');
    setBusy(false);
  };

  const saveServer = async () => {
    setServerResult(null);
    setServerResult(await window.bcis.config.setServerUrl(serverUrl));
  };

  return (
    <div className="flex h-full">
      <div className="flex w-[42%] flex-col justify-between bg-navy p-10 text-white">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded bg-accent text-sm font-bold">BC</span>
          <div className="leading-tight">
            <p className="font-semibold">Bukidnon Cable and Internet Services</p>
            <p className="text-xs text-slate-300">Subscription Billing and Collection System</p>
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-semibold leading-snug">Billing, collection and subscriber ledgers in one place.</h1>
          <ul className="mt-5 space-y-2 text-sm text-slate-300">
            <li>Monthly billing for Internet, Cable and Combo subscriptions</li>
            <li>Cash and verified GCash payments with automatic allocation</li>
            <li>Collector batches, remittance and reconciliation</li>
            <li>Receivable aging, overdue monitoring and audit-ready reports</li>
          </ul>
        </div>
        <p className="text-xs text-slate-400">Version {version} · Authorized office use only</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="w-88">
          <form onSubmit={submit} className="rounded-lg border border-line bg-surface p-7 shadow-sm">
            <h2 className="text-lg font-semibold">Sign in</h2>
            <p className="mb-5 text-sm text-muted">Use the account issued to you by the owner.</p>
            <div className="space-y-3.5">
              <Field label="Username" required>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" spellCheck={false} />
              </Field>
              <Field label="Password" required>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </Field>
              {error && <Notice tone="danger">{error}</Notice>}
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!username || !password}>
                Sign in
              </Button>
            </div>
          </form>

          <div className="mt-3 rounded-lg border border-line bg-surface px-4 py-2.5">
            <button type="button" onClick={() => setShowServer((s) => !s)} className="flex w-full items-center justify-between text-xs text-muted hover:text-ink" aria-expanded={showServer}>
              <span className="inline-flex items-center gap-1.5">
                <Server className="size-3.5" /> Server: {serverUrl.replace(/^https?:\/\//, '')}
              </span>
              <span className="font-medium text-accent">{showServer ? 'Hide' : 'Change'}</span>
            </button>
            {showServer && (
              <div className="mt-3 space-y-2">
                <Field label="BCIS server address" hint="The address of the office server PC, for example http://192.168.1.10:4000">
                  <Input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} spellCheck={false} />
                </Field>
                <div className="flex gap-2">
                  <Button size="sm" onClick={async () => setServerResult(await window.bcis.config.test(serverUrl))}>
                    Test connection
                  </Button>
                  <Button size="sm" variant="navy" onClick={() => void saveServer()}>
                    Save
                  </Button>
                </div>
                {serverResult && <Notice tone={serverResult.ok ? 'success' : 'danger'}>{serverResult.message}</Notice>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

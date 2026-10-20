import { AlertTriangle } from 'lucide-react';
import { explainProviderError } from '@/lib/provider-errors';
export default function ProviderErrorNotice({ error }: { error: string }) {
  const issue = explainProviderError(error);
  return (
    <div className={`provider-issue ${issue.kind}`} role="status">
      <div>
        <AlertTriangle size={18} />
        <strong>{issue.title}</strong>
      </div>
      <p>{issue.message}</p>
      <p className="provider-advice">{issue.advice}</p>
      <details>
        <summary>Technical details</summary>
        <pre>{error}</pre>
      </details>
    </div>
  );
}

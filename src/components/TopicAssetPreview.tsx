import { useEffect, useState } from 'react';
import { topicRequest } from '../topic-library';
import type { TopicAsset } from '../topics';
import { parseDataPreview } from '../topics';
export function TopicAssetPreview({ asset }: { asset: TopicAsset }) {
  const [preview, setPreview] = useState<{ url?: string; text?: string; rows?: string[][]; error?: string }>({});
  useEffect(() => {
    const extension = (asset.filename || '').split('.').pop()?.toLowerCase() || '';
    if (!asset.vaultPath || (asset.size || 0) > 8 * 1024 * 1024 || !['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'csv', 'tsv', 'txt', 'md', 'json', 'log', 'py', 'r'].includes(extension)) { setPreview({}); return; }
    let live = true, url: string | undefined;
    setPreview({});
    void topicRequest<{ bytes: Uint8Array }>('read-asset', { path: asset.vaultPath }).then(result => {
      if (!live) return;
      const bytes = new Uint8Array(result.bytes);
      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension)) { url = URL.createObjectURL(new Blob([bytes], { type: extension === 'svg' ? 'image/svg+xml' : extension === 'jpg' ? 'image/jpeg' : `image/${extension}` })); setPreview({ url }); }
      else { const text = new TextDecoder().decode(bytes); setPreview(extension === 'csv' || extension === 'tsv' ? { rows: parseDataPreview(text, extension === 'tsv' ? '\t' : ',') } : { text: text.slice(0, 20000) }); }
    }).catch(error => { if (live) setPreview({ error: error.message }); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [asset.vaultPath, asset.filename, asset.size]);
  if (preview.error) return <div role="alert" className="topic-error">{preview.error}</div>;
  if (preview.url) return <div className="topic-asset-preview"><img src={preview.url} alt={asset.title} /></div>;
  if (preview.rows) return <div className="topic-asset-preview topic-table-scroll"><table className="topic-table" aria-label="数据预览"><tbody>{preview.rows.map((row, i) => <tr key={i}>{row.map((value, j) => i === 0 ? <th key={j}>{value}</th> : <td key={j}>{value}</td>)}</tr>)}</tbody></table></div>;
  if (preview.text !== undefined) return <pre className="topic-asset-preview topic-text-preview">{preview.text}</pre>;
  return null;
}

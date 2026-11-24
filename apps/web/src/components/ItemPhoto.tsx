import { useState } from 'react';

export function ItemPhoto({ src, name }: { src: string; name: string }): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="item-photo">
      {failed === src ? <p role="status">Photo unavailable.</p> : (
        <img src={src} alt={`Photo of ${name || 'this item'}`} onError={() => setFailed(src)} />
      )}
    </div>
  );
}

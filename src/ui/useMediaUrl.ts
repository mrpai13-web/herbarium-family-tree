import { useEffect, useState } from 'react';
import { mediaUrl } from '../data/media';

/** Object URL for a stored media blob; undefined while loading or when id is empty. */
export function useMediaUrl(id: string | undefined, which: 'blob' | 'thumb' = 'blob'): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    if (id) void mediaUrl(id, which).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id, which]);
  return url;
}

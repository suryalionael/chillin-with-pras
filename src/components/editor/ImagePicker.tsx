import { useState, useEffect, useCallback } from 'react';

interface ImageRecord {
  id: string;
  r2_original: string;
  variants: unknown[];
  width: number;
  height: number;
  bytes: number;
  mime: string;
  sha256: string;
  filename: string;
  created_at: string;
}

interface ImagePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (image: ImageRecord) => void;
  onUpload: (file: File) => Promise<ImageRecord | null>;
}

export function ImagePicker({ isOpen, onClose, onSelect, onUpload }: ImagePickerProps) {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<'library' | 'upload'>('upload');

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/images/', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Failed to load images');
      const data = await res.json();
      if (data.images) setImages(data.images);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load images');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && tab === 'library') {
      fetchImages();
    }
  }, [isOpen, tab, fetchImages]);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/images/', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || 'Upload failed');
      }
      const data = await res.json();
      if (data.image && !data.image.duplicate) {
        setImages((prev) => [data.image, ...prev]);
      }
      onUpload(file);
      return data.image;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFileUpload(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
      e.target.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="image-picker-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="image-picker-title">
      <div className="image-picker" onClick={(e) => e.stopPropagation()}>
        <header className="image-picker__header">
          <h2 id="image-picker-title" className="image-picker__title">Add image</h2>
          <button className="image-picker__close" onClick={onClose} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <div className="image-picker__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'upload'}
            className={`image-picker__tab ${tab === 'upload' ? 'active' : ''}`}
            onClick={() => setTab('upload')}
          >
            Upload
          </button>
          <button
            role="tab"
            aria-selected={tab === 'library'}
            className={`image-picker__tab ${tab === 'library' ? 'active' : ''}`}
            onClick={() => setTab('library')}
          >
            Library
          </button>
        </div>

        {error && <div className="image-picker__error" role="alert">{error}</div>}

        {tab === 'upload' && (
          <div className="image-picker__upload">
            <div
              className="image-picker__dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                id="image-upload-input"
                className="image-picker__file-input"
                disabled={uploading}
              />
              <label htmlFor="image-upload-input" className="image-picker__dropzone-label">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p>Drag & drop an image, or click to browse</p>
                <span className="image-picker__hint">JPEG, PNG, WebP · max 20MB</span>
              </label>
            </div>
            {uploading && <div className="image-picker__uploading">Uploading…</div>}
          </div>
        )}

        {tab === 'library' && (
          <div className="image-picker__library">
            {loading ? (
              <div className="image-picker__loading">Loading…</div>
            ) : images.length === 0 ? (
              <div className="image-picker__empty">No images yet. Upload your first image.</div>
            ) : (
              <div className="image-picker__grid" role="listbox" aria-label="Image library">
                {images.map((img) => (
                  <button
                    key={img.id}
                    role="option"
                    className="image-picker__item"
                    onClick={() => {
                      onSelect(img);
                      onClose();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(img);
                        onClose();
                      }
                    }}
                  >
                    <img
                      src={`/images/${img.id}`}
                      alt=""
                      loading="lazy"
                      className="image-picker__thumb"
                    />
                    <span className="image-picker__filename">{img.filename}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
-- Hash of upload bytes before orientation/metadata normalization. No EXIF retained.
ALTER TABLE attachments ADD COLUMN source_sha256 TEXT;

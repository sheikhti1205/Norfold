-- A conversation carries any ordinary file, not only
-- the short office/video list the first transport migration installed.
--
-- WHAT CHANGES. `findback-chat-files` keeps its 20 MB ceiling and its private,
-- participant-only object policies; only `allowed_mime_types` widens. Images
-- now travel through the file lane as well as through the photo control, and
-- a format the browser cannot name travels as `application/octet-stream`, the
-- explicit client catch-all.
--
-- WHAT STAYS OUT. Executables, installers, scripts, HTML and SVG are still
-- absent. `application/octet-stream` means Storage cannot tell an ordinary
-- `.psd` from a renamed program: it only sees the declared MIME header, never
-- the filename, so it cannot make that distinction. The refusal guard is the
-- client list in `apps/mobile/src/services/messaging/files.ts`
-- (REFUSED_EXTENSIONS / REFUSED_MIME), which stops a program before upload
-- with clear copy. That is acceptable because this bucket is transport only:
-- it is private, every object sits under `files/<sender>/<conversation>/`,
-- the Storage policies let only the two participants read it, and the client
-- downloads every non-media object as a blob rather than rendering it as a
-- page.
--
-- PARITY. `CHAT_FILE_MIME_ALLOWLIST` in the client must match the array below
-- exactly; `apps/mobile/src/services/messaging/files.test.ts` parses this file
-- and fails on drift. Forward-only: the exact array is written out, with no
-- dynamic SQL, so the applied state is the reviewed state.

begin;

update storage.buckets
   set allowed_mime_types = array[
     -- images (the photo control keeps its own byte-verified lane)
     'image/jpeg',
     'image/png',
     'image/gif',
     'image/webp',
     'image/bmp',
     'image/tiff',
     'image/heic',
     'image/heif',
     'image/avif',
     -- video
     'video/mp4',
     'video/webm',
     'video/quicktime',
     'video/x-matroska',
     'video/x-msvideo',
     'video/x-m4v',
     'video/3gpp',
     -- audio (voice notes keep the media lane)
     'audio/mpeg',
     'audio/mp4',
     'audio/ogg',
     'audio/wav',
     'audio/x-wav',
     'audio/flac',
     'audio/aac',
     'audio/opus',
     'audio/webm',
     -- archives
     'application/zip',
     'application/x-zip-compressed',
     'application/x-7z-compressed',
     'application/x-rar-compressed',
     'application/vnd.rar',
     'application/gzip',
     'application/x-tar',
     -- documents
     'application/pdf',
     'application/rtf',
     'text/plain',
     'text/csv',
     'application/json',
     'application/xml',
     'text/xml',
     'text/markdown',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/vnd.oasis.opendocument.text',
     'application/vnd.oasis.opendocument.spreadsheet',
     'application/vnd.oasis.opendocument.presentation',
     'application/epub+zip',
     'application/x-mobipocket-ebook',
     -- explicit catch-all: a file whose type nothing can name still travels
     'application/octet-stream'
   ],
   updated_at = now()
 where id = 'findback-chat-files';

commit;

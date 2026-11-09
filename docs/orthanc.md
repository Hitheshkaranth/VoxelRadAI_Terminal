# Orthanc / DICOMweb archive

Skanda has a read-only, administrator-only DICOMweb proxy. An authenticated app administrator can search studies, browse their series and instances, and import one instance using the existing browser DICOM decoder. Ordinary users cannot access the archive, even when they know an instance UID. This is an archive-wide administrator permission, not patient-level authorization.

## Existing archive

Configure the API process, never the browser build:

```dotenv
DICOMWEB_BASE_URL=https://archive.example/dicom-web/
DICOMWEB_USERNAME=skanda-service
DICOMWEB_PASSWORD=replace-with-secret
```

Use a dedicated read-only service account or an upstream authorization gateway enforcing read-only access. The proxy itself exposes no upload, deletion, arbitrary URL, arbitrary query tags or header forwarding. Its configured base URL cannot include credentials, query parameters or a fragment; redirects are rejected. Credentials remain on the server. Use HTTPS with a trusted certificate. `DICOMWEB_ALLOW_HTTP=true` is an explicit exception for an isolated private network only.

The [official Orthanc DICOMweb documentation](https://orthanc.uclouvain.be/book/plugins/dicomweb.html) describes enabling the plugin and the `/dicom-web/` root. Configure the plugin's host allowlist or host setting for the API's actual destination. Orthanc authentication applies to the plugin too.

## Optional local private archive

Set a unique `ORTHANC_PASSWORD` in your untracked environment file, then combine overlays:

```sh
docker compose -f compose.yaml -f compose.orthanc.yaml up -d --build
```

This adds Orthanc 26.7.0, durable `orthanc-data` storage and an internal network shared only with the API. It publishes no Orthanc HTTP or DICOM port and disables the DICOM listener. The API uses the explicitly permitted private HTTP connection. The image's environment variable and password behavior are documented in the [official Orthanc Team image guide](https://orthanc.uclouvain.be/book/users/docker-orthancteam.html). Upgrade the pinned image deliberately after compatibility testing. Keep verbose startup disabled because it can expose configuration secrets.

Populate or administer this archive through a separately controlled operational connection; the app does not add studies to Orthanc. Back up its data volume independently of Skanda's database and object storage. Validate restoration with the same pinned Orthanc release before upgrading. Do not expose an unauthenticated Orthanc port to make importing easier.

## API contract and limits

- `GET /api/admin/pacs/status`: configuration status without endpoint or credential disclosure.
- `POST /api/admin/pacs/query`: JSON `level` (`studies`, `series`, `instances`), required parent UIDs for nested levels, optional `patientId` / `studyDate` for study search, `limit` 1–50 and `offset` 0–10000. Returns minimized `items`, `hasMore`, `offset`, `limit`.
- `POST /api/admin/pacs/instance`: JSON `studyUid`, `seriesUid`, `instanceUid`. Returns one DICOM file, with no cache and a generic download filename.

POST requests require the exact configured app Origin and an active administrator session. Queries use POST so patient filters are not in app access-log URLs. Avoid logging request bodies. Audit events record the acting administrator and operation without names, patient identifiers or UIDs. QIDO metadata is capped at 2 MB, instance bytes at 60 MB, requests at 30 seconds and concurrent upstream work at two requests per API process. Returned parent identities must match the request. Multipart WADO responses must contain exactly one DICOM instance. The proxy requests Explicit VR Little Endian transfer syntax; transcoding availability depends on the archive.

The browser still applies its normal limits and rejects unsupported DICOM encodings, color formats, enhanced functional groups and invalid multiframe data. Retrieval is not series-to-volume reconstruction. Importing an instance creates a separate local study; it does not silently merge another patient's images, infer CT calibration, assign an MRI sequence or establish spatial geometry. Browser and server study-upload limits can be lower than a retrieved DICOM file after decoding; failures are explicit. No claims of clinical validation or DICOM conformance certification are made.

## Verification

Run `node --test server/test/dicomweb.test.mjs` for proxy boundary tests. Before use with patient data, validate an actual configured archive using de-identified studies: search → select study → series → instance → import, including a multiframe instance and an unsupported transfer syntax. Confirm ordinary users receive 403, wrong-origin POSTs receive 403, missing instances report a visible error, and no archive credentials appear in browser requests. Automated mocked transport tests do not establish a live Orthanc deployment or clinical compatibility.

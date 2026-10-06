# StreamX Verification & Testing Strategy

This test plan implements Section 41 of the StreamX master specification.

| Test ID | Scenario | Expected Outcome | Verification Method |
|---|---|---|---|
| **Test A** | Small file transfer (10MB-50MB) | File forwarded to bot -> Worker transfers to Google Drive -> Media indexed in SQLite & visible in API | Live execution log & Drive file listing |
| **Test B** | Large file transfer (500MB+) | Chunked transfer without memory explosion (<50MB RAM consumed) | Live memory profiler / worker metrics |
| **Test C** | Network interruption during transfer | Worker pauses, backs off, and resumes from last committed byte offset upon reconnect | Simulated connection drop (SIGSTOP/network toggle) |
| **Test D** | Worker process kill & restart | Worker restarts, reads SQLite state, finds incomplete transfer, resumes Google Drive session | Kill worker process mid-transfer, restart worker |
| **Test E** | Android download & resume | Device streams media from Drive / backend into local storage; pausing and resuming works smoothly | Download test with network toggle |
| **Test F** | Offline Playback | Video plays smoothly with airplane mode enabled | Open local file in offline media player without internet |
| **Test G** | Local delete safety | Deleting downloaded file removes Android copy only; Google Drive master stays untouched | Delete in app, verify Drive file still exists |
| **Test H** | Duplicate detection | Forwarding the same Telegram media twice does not create duplicate Drive files | Hash/file_id check skips redundant upload |
| **Test I** | Filename parsing & noise stripping | Complex scene filenames parsed into canonical title, year, quality, and season/episode | `pytest tests/test_filename_parser.py` |
| **Test J** | Multi-factor confidence scoring | High, medium, low confidence thresholds and year disambiguation (e.g. Dune 2021 vs 1984) | `pytest tests/test_confidence_scorer.py` |
| **Test K** | Metadata deduplication & caching | Multiple resolutions of same film share one `metadata_entities` record | `pytest tests/test_metadata_service.py` |
| **Test L** | Manual override & locking | Manually matched items get locked and never overwritten by auto-enrichment | `pytest tests/test_metadata_service.py` |
| **Test M** | Metadata API & backfill | Enriched canonical metadata served via `/media` and `/media/search`, backfill enqueues items | `pytest tests/test_metadata_api.py` |

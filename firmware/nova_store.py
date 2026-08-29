"""Offline queue and authorisation cache, both on the ESP32's flash.

The door has to keep working when Wi-Fi does not. Two files:

  queue.jsonl  one JSON event per line, appended on every offline scan and
               drained by /device-sync. Append-only so a power cut mid-write
               costs at most the last line.
  cache.json   the {fingerprint_id, name, allowed} list handed back by
               /device-sync. No biometric data - just the door decision.
"""

import json
import os

QUEUE_PATH = "queue.jsonl"
CACHE_PATH = "cache.json"
COUNTER_PATH = "counter.txt"
MAX_QUEUE = 500


def _exists(path):
    try:
        os.stat(path)
        return True
    except OSError:
        return False


class Store:
    def __init__(self, device_code):
        self.device_code = device_code
        self.cache = self._load_cache()
        self.counter = self._load_counter()

    # --- event ids ----------------------------------------------------------
    def next_event_id(self):
        """device code + monotonic counter, as docs/API.md suggests. Unique in
        Postgres, so a replayed queue can never double-insert."""
        self.counter += 1
        try:
            with open(COUNTER_PATH, "w") as f:
                f.write(str(self.counter))
        except OSError:
            pass
        return "%s-%06d" % (self.device_code, self.counter)

    def _load_counter(self):
        try:
            with open(COUNTER_PATH) as f:
                return int(f.read().strip())
        except (OSError, ValueError):
            return 0

    # --- offline queue ------------------------------------------------------
    def enqueue(self, event):
        if self.pending() >= MAX_QUEUE:
            self._drop_oldest()
        try:
            with open(QUEUE_PATH, "a") as f:
                f.write(json.dumps(event) + "\n")
        except OSError:
            pass

    def queued(self, limit=200):
        out = []
        if not _exists(QUEUE_PATH):
            return out
        try:
            with open(QUEUE_PATH) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        continue          # torn line from a power cut
                    if len(out) >= limit:
                        break
        except OSError:
            pass
        return out

    def pending(self):
        return len(self.queued(MAX_QUEUE))

    def drop(self, event_ids):
        """Remove accepted events. Rewrites the file, so it only runs after a
        successful sync, not on every scan."""
        if not event_ids or not _exists(QUEUE_PATH):
            return
        keep = [e for e in self.queued(MAX_QUEUE)
                if e.get("event_id") not in set(event_ids)]
        try:
            with open(QUEUE_PATH, "w") as f:
                for e in keep:
                    f.write(json.dumps(e) + "\n")
        except OSError:
            pass

    def _drop_oldest(self):
        events = self.queued(MAX_QUEUE)[1:]
        try:
            with open(QUEUE_PATH, "w") as f:
                for e in events:
                    f.write(json.dumps(e) + "\n")
        except OSError:
            pass

    # --- authorisation cache ------------------------------------------------
    def _load_cache(self):
        try:
            with open(CACHE_PATH) as f:
                return {int(k): v for k, v in json.load(f).items()}
        except (OSError, ValueError):
            return {}

    def save_cache(self, entries):
        self.cache = {int(e["fingerprint_id"]): {
            "name": e.get("name", ""),
            "allowed": bool(e.get("allowed")),
        } for e in entries if e.get("fingerprint_id") is not None}
        try:
            with open(CACHE_PATH, "w") as f:
                json.dump({str(k): v for k, v in self.cache.items()}, f)
        except OSError:
            pass

    def decide_offline(self, fingerprint_id):
        """The door decision while offline. Returns (allowed, name, reason)."""
        entry = self.cache.get(int(fingerprint_id))
        if entry is None:
            return False, "", "FINGERPRINT_NOT_REGISTERED"
        if entry["allowed"]:
            return True, entry["name"], "OK"
        return False, entry["name"], "NO_ACTIVE_MEMBERSHIP"

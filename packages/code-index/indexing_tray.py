#!/usr/bin/env python3
"""Linux System Tray indicator for P Code Indexing service.

Automatically detects headless server environments and exits cleanly if no
display server (X11 / Wayland) is available.
"""

from __future__ import annotations

import datetime
import fcntl
import json
import os
import signal
import subprocess
import sys
import uuid
from pathlib import Path


def is_gui_available() -> bool:
    """Check if a graphical X11 or Wayland display session is available."""
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def get_agent_dir() -> Path:
    env_dir = os.environ.get("P_CODING_AGENT_DIR")
    if env_dir:
        return Path(env_dir)
    return Path.home() / ".p" / "agent"


def read_json_file(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


class IndexingTrayApp:
    def __init__(self, agent_dir: Path):
        self.agent_dir = agent_dir
        self.status_file = agent_dir / "indexing-service-status.json"
        self.config_file = agent_dir / "code-rag.json"
        self.registry_file = agent_dir / "indexed-repos.json"
        self.indicator = None
        self.app = None

    def run(self) -> None:
        try:
            import gi
            gi.require_version("Gtk", "3.0")
            from gi.repository import GLib, Gtk

            try:
                gi.require_version("AyatanaAppIndicator3", "0.1")
                from gi.repository import AyatanaAppIndicator3 as AppIndicator3
            except (ValueError, ImportError):
                try:
                    gi.require_version("AppIndicator3", "0.1")
                    from gi.repository import AppIndicator3
                except (ValueError, ImportError):
                    AppIndicator3 = None

            if AppIndicator3 is not None:
                self.indicator = AppIndicator3.Indicator.new(
                    "p-code-indexing-tray", "system-search", AppIndicator3.IndicatorCategory.APPLICATION_STATUS)
                self.indicator.set_status(AppIndicator3.IndicatorStatus.ACTIVE)
                self.rebuild_menu(Gtk)
                GLib.timeout_add_seconds(2, self.on_timer_tick, Gtk)
                Gtk.main()
            else:
                self.run_fallback_gtk(Gtk, GLib)
        except Exception:
            sys.exit(0)

    def run_fallback_gtk(self, Gtk, GLib) -> None:
        try:
            status_icon = Gtk.StatusIcon.new_from_icon_name("system-search")
            status_icon.set_title("P Code Indexing")
            status_icon.connect("popup-menu", self.on_status_icon_popup, Gtk)
            GLib.timeout_add_seconds(2, self.on_timer_tick_fallback, status_icon)
            Gtk.main()
        except Exception:
            sys.exit(0)

    def on_status_icon_popup(self, icon, button, activate_time, Gtk) -> None:
        menu = self.create_menu(Gtk)
        menu.show_all()
        menu.popup(None, None, Gtk.StatusIcon.position_menu, icon, button, activate_time)

    def on_timer_tick(self, Gtk) -> bool:
        self.rebuild_menu(Gtk)
        return True

    def on_timer_tick_fallback(self, status_icon) -> bool:
        status_data = read_json_file(self.status_file)
        running = status_data.get("running", False)
        repos = status_data.get("repos", [])
        is_indexing = any(r.get("state") == "indexing" for r in repos)
        if not running:
            status_icon.set_tooltip_text("P Code Indexing (Stopped)")
        elif is_indexing:
            status_icon.set_tooltip_text("P Code Indexing (Indexing...)")
        else:
            status_icon.set_tooltip_text("P Code Indexing (Idle)")
        return True

    def rebuild_menu(self, Gtk) -> None:
        if self.indicator is None:
            return
        menu = self.create_menu(Gtk)
        menu.show_all()
        self.indicator.set_menu(menu)

    def create_menu(self, Gtk):
        menu = Gtk.Menu()
        status_data = read_json_file(self.status_file)
        config_data = read_json_file(self.config_file)

        running = status_data.get("running", False)
        repos = status_data.get("repos", [])
        is_indexing = any(r.get("state") == "indexing" for r in repos)

        # 1. Title
        title_item = Gtk.MenuItem(label="P Code Indexing")
        title_item.set_sensitive(False)
        menu.append(title_item)

        # 2. Status
        if not running:
            status_text = "  Status: Stopped"
        elif is_indexing:
            active = next((r for r in repos if r.get("state") == "indexing"), None)
            name = Path(active["path"]).name if active and "path" in active else "repo"
            pct = ""
            if active and isinstance(active.get("progress"), dict):
                p = active["progress"].get("percent")
                if p is not None:
                    pct = f" ({int(p)}%)"
            status_text = f"  Status: Indexing {name}{pct}"
        else:
            status_text = "  Status: Ready (Idle)"
        status_item = Gtk.MenuItem(label=status_text)
        status_item.set_sensitive(False)
        menu.append(status_item)

        # 3. Device
        device = config_data.get("embeddingDevice", "Auto")
        mode = "BM25 Fast" if config_data.get("searchMode") == "bm25-only" else f"Hybrid ({device})"
        device_item = Gtk.MenuItem(label=f"  Device: {mode}")
        device_item.set_sensitive(False)
        menu.append(device_item)

        menu.append(Gtk.SeparatorMenuItem())

        # 4. Repositories
        if not repos:
            empty_item = Gtk.MenuItem(label="No repositories configured")
            empty_item.set_sensitive(False)
            menu.append(empty_item)
        else:
            repos_root = Gtk.MenuItem(label=f"Repositories ({len(repos)})")
            repos_menu = Gtk.Menu()
            repos_root.set_submenu(repos_menu)

            for repo in repos:
                repo_path = repo.get("path", "")
                name = Path(repo_path).name or repo_path
                state = repo.get("state", "unknown")
                if state == "indexing":
                    desc = "Indexing"
                elif state == "error":
                    desc = "Error"
                else:
                    files = repo.get("indexedFiles", 0)
                    desc = f"Ready ({files} files)"

                r_item = Gtk.MenuItem(label=f"{name} - {desc}")
                r_sub = Gtk.Menu()
                r_item.set_submenu(r_sub)

                pri_item = Gtk.MenuItem(label="Prioritize / Re-index")
                pri_item.connect("activate", lambda _, p=repo_path: self.prioritize_repo(p))
                r_sub.append(pri_item)

                repos_menu.append(r_item)

            menu.append(repos_root)

        menu.append(Gtk.SeparatorMenuItem())

        # 5. Actions
        reindex_item = Gtk.MenuItem(label="Reindex All Repositories")
        reindex_item.connect("activate", lambda _: self.reindex_all(repos))
        reindex_item.set_sensitive(running)
        menu.append(reindex_item)
        logs_item = Gtk.MenuItem(label="View Service Logs...")
        logs_item.connect("activate", lambda _: self.open_file(self.agent_dir / "indexing-service" / "logs" / "service.log"))
        menu.append(logs_item)
        config_item = Gtk.MenuItem(label="Open Configuration...")
        config_item.connect("activate", lambda _: self.open_file(self.config_file))
        menu.append(config_item)
        restart_item = Gtk.MenuItem(label="Restart Indexing Service")
        restart_item.connect("activate", lambda _: self.restart_service())
        menu.append(restart_item)
        menu.append(Gtk.SeparatorMenuItem())

        # 6. Settings & Quit
        disable_item = Gtk.MenuItem(label="Disable Tray Icon (from settings)")
        disable_item.connect("activate", lambda _: self.disable_tray(Gtk))
        menu.append(disable_item)
        quit_item = Gtk.MenuItem(label="Quit Tray Indicator")
        quit_item.connect("activate", lambda _: Gtk.main_quit())
        menu.append(quit_item)
        return menu

    def prioritize_repo(self, repo_path: str) -> None:
        if not repo_path or not self.registry_file.exists():
            return
        data = read_json_file(self.registry_file)
        repos = data.get("repos", [])
        if not isinstance(repos, list):
            return
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        req_id = str(uuid.uuid4())
        for repo in repos:
            if isinstance(repo, dict) and repo.get("path") == repo_path:
                repo["priorityRequest"] = {"id": req_id, "requestedAt": now}
                break
        temp_file = self.registry_file.with_suffix(f".{os.getpid()}.tmp")
        try:
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            temp_file.replace(self.registry_file)
        except Exception:
            pass

    def reindex_all(self, repos: list) -> None:
        for repo in repos:
            if "path" in repo:
                self.prioritize_repo(repo["path"])

    def open_file(self, path: Path) -> None:
        if path.exists():
            subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def restart_service(self) -> None:
        subprocess.Popen(["systemctl", "--user", "restart", "com.dst.p.code-index.service"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def disable_tray(self, Gtk) -> None:
        config = read_json_file(self.config_file)
        config["enableTray"] = False
        with open(self.config_file, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        Gtk.main_quit()


def acquire_single_instance_lock(agent_dir: Path):
    lock_file = agent_dir / "indexing-tray.pid"
    try:
        agent_dir.mkdir(parents=True, exist_ok=True)
        fd = open(lock_file, "w")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd.write(str(os.getpid()) + "\n")
        fd.flush()
        return fd
    except (IOError, OSError):
        return None


def main() -> None:
    if not is_gui_available():
        sys.exit(0)

    agent_dir = get_agent_dir()
    lock = acquire_single_instance_lock(agent_dir)
    if lock is None:
        sys.exit(0)

    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    config = read_json_file(agent_dir / "code-rag.json")
    if config.get("enableTray") is False:
        sys.exit(0)

    app = IndexingTrayApp(agent_dir)
    app.run()


if __name__ == "__main__":
    main()

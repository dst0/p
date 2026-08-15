import Cocoa
import Foundation

// MARK: - Status Item Manager

final class IndexingStatusItemManager: NSObject, NSMenuDelegate {
    private let statusItem: NSStatusItem
    private let agentDir: String
    private var timer: Timer?
    private var fileSource: DispatchSourceFileSystemObject?
    private var fileDescriptor: Int32 = -1
    private var currentStatus: IndexingStatusData?
    private var currentConfig: CodeRagConfig?
    private var isIndexingActive = false

    init(agentDir: String) {
        self.agentDir = agentDir
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()

        setupStatusButton()
        reloadStatus()
        setupWatcher()
    }

    deinit {
        timer?.invalidate()
        if let source = fileSource { source.cancel() }
        if fileDescriptor >= 0 { close(fileDescriptor) }
    }

    private func setupStatusButton() {
        guard let button = statusItem.button else { return }
        button.image = createTrayIcon(isIndexing: false, isError: false)
        button.imagePosition = .imageLeft
        button.toolTip = "P Code Indexing Service"

        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
    }

    private func reloadStatus() {
        let statusPath = agentDir + "/indexing-service-status.json"
        let configPath = agentDir + "/code-rag.json"

        if let configData = try? Data(contentsOf: URL(fileURLWithPath: configPath)) {
            currentConfig = try? JSONDecoder().decode(CodeRagConfig.self, from: configData)
        }

        if let statusData = try? Data(contentsOf: URL(fileURLWithPath: statusPath)) {
            currentStatus = try? JSONDecoder().decode(IndexingStatusData.self, from: statusData)
        }

        let running = isDaemonProcessRunning()
        let anyIndexing = running && (currentStatus?.repos.contains { $0.state == "indexing" } ?? false)
        let anyError = running && (currentStatus?.repos.contains { $0.state == "error" } ?? false)

        isIndexingActive = anyIndexing
        if let button = statusItem.button {
            button.image = createTrayIcon(isIndexing: anyIndexing, isError: !running || anyError)
            if anyIndexing {
                let indexingRepo = currentStatus?.repos.first { $0.state == "indexing" }
                let pct = indexingRepo?.progress?.percent.map { " (\(Int($0))%)" } ?? ""
                button.toolTip = "Indexing: \(URL(fileURLWithPath: indexingRepo?.path ?? "").lastPathComponent)\(pct)"
            } else if !running {
                button.toolTip = "P Code Indexing (Stopped)"
            } else {
                button.toolTip = "P Code Indexing (Idle)"
            }
        }
    }

    private func isDaemonProcessRunning() -> Bool {
        guard let pid = currentStatus?.pid, currentStatus?.running == true else { return false }
        return kill(pid_t(pid), 0) == 0 || errno == EPERM
    }

    private func setupWatcher() {
        armFileSource()
        timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.reloadStatus()
        }
    }

    private func armFileSource() {
        if let source = fileSource { source.cancel() }
        let statusPath = agentDir + "/indexing-service-status.json"
        fileDescriptor = open(statusPath, O_EVTONLY)
        if fileDescriptor >= 0 {
            let source = DispatchSource.makeFileSystemObjectSource(
                fileDescriptor: fileDescriptor,
                eventMask: [.write, .extend, .delete, .rename],
                queue: DispatchQueue.main
            )
            source.setEventHandler { [weak self] in
                self?.reloadStatus()
                let flags = source.data
                if flags.contains(.delete) || flags.contains(.rename) {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        self?.armFileSource()
                    }
                }
            }
            source.setCancelHandler { [weak self] in
                if let fd = self?.fileDescriptor, fd >= 0 { close(fd) }
                self?.fileDescriptor = -1
            }
            source.resume()
            self.fileSource = source
        }
    }

    // MARK: - Menu Delegate

    func menuWillOpen(_ menu: NSMenu) {
        menu.removeAllItems()
        reloadStatus()

        let running = isDaemonProcessRunning()
        let builtMenu = buildStatusMenu(
            target: self,
            running: running,
            isIndexingActive: isIndexingActive,
            currentStatus: currentStatus,
            currentConfig: currentConfig
        )
        for item in builtMenu.items {
            builtMenu.removeItem(item)
            menu.addItem(item)
        }
    }

    // MARK: - Action Handlers

    @objc func revealInFinder(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        NSWorkspace.shared.selectFile(path, inFileViewerRootedAtPath: "")
    }

    @objc func openInTerminal(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        let script = "tell application \"Terminal\" to do script \"cd " + path.replacingOccurrences(of: "\"", with: "\\\"") + "\""
        if let appleScript = NSAppleScript(source: script) {
            var error: NSDictionary?
            appleScript.executeAndReturnError(&error)
        }
    }

    @objc func prioritizeRepo(_ sender: NSMenuItem) {
        guard let targetPath = sender.representedObject as? String else { return }
        let registryFile = agentDir + "/indexed-repos.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: registryFile)),
              var json = (try? JSONSerialization.jsonObject(with: data, options: [])) as? [String: Any],
              var repos = json["repos"] as? [[String: Any]] else { return }

        let now = ISO8601DateFormatter().string(from: Date())
        let reqId = UUID().uuidString
        for idx in 0..<repos.count {
            if (repos[idx]["path"] as? String) == targetPath {
                repos[idx]["priorityRequest"] = ["id": reqId, "requestedAt": now]
                break
            }
        }
        json["repos"] = repos
        if let updatedData = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted]) {
            let tempUrl = URL(fileURLWithPath: "\(registryFile).\(ProcessInfo.processInfo.processIdentifier).tmp")
            try? updatedData.write(to: tempUrl)
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: registryFile))
            try? FileManager.default.moveItem(at: tempUrl, to: URL(fileURLWithPath: registryFile))
        }
    }

    @objc func reindexAll() {
        guard let repos = currentStatus?.repos else { return }
        for repo in repos {
            let item = NSMenuItem()
            item.representedObject = repo.path
            prioritizeRepo(item)
        }
    }

    @objc func openLogs() {
        let logPath = agentDir + "/indexing-service/logs/service.log"
        NSWorkspace.shared.open(URL(fileURLWithPath: logPath))
    }

    @objc func openConfig() {
        let configPath = agentDir + "/code-rag.json"
        NSWorkspace.shared.open(URL(fileURLWithPath: configPath))
    }

    @objc func restartService() {
        let uid = getuid()
        let task = Process()
        task.launchPath = "/bin/launchctl"
        task.arguments = ["kickstart", "-k", "gui/\(uid)/com.dst.p.code-index"]
        try? task.run()
    }

    @objc func disableTrayIcon() {
        let configPath = agentDir + "/code-rag.json"
        if let configData = try? Data(contentsOf: URL(fileURLWithPath: configPath)),
           var json = (try? JSONSerialization.jsonObject(with: configData, options: [])) as? [String: Any] {
            json["enableTray"] = false
            if let updatedData = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted]) {
                try? updatedData.write(to: URL(fileURLWithPath: configPath))
            }
        }
        NSApplication.shared.terminate(nil)
    }

    @objc func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}

func acquireSingleInstanceLock(agentDir: String) -> Int32? {
    let lockPath = agentDir + "/indexing-tray.pid"
    let fd = open(lockPath, O_RDWR | O_CREAT, 0o644)
    if fd < 0 { return nil }
    if flock(fd, LOCK_EX | LOCK_NB) != 0 {
        close(fd)
        return nil
    }
    ftruncate(fd, 0)
    let pidStr = "\(ProcessInfo.processInfo.processIdentifier)\n"
    if let data = pidStr.data(using: .utf8) {
        _ = data.withUnsafeBytes { write(fd, $0.baseAddress, data.count) }
    }
    return fd
}

// MARK: - Main Application Entry

let agentDir = ProcessInfo.processInfo.environment["P_CODING_AGENT_DIR"]
    ?? (FileManager.default.homeDirectoryForCurrentUser.path + "/.p/agent")
guard let _ = acquireSingleInstanceLock(agentDir: agentDir) else {
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = IndexingStatusItemManager(agentDir: agentDir)
app.run()

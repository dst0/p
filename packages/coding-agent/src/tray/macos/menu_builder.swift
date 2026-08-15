import Cocoa
import Foundation

func buildStatusMenu(
    target: AnyObject,
    running: Bool,
    isIndexingActive: Bool,
    currentStatus: IndexingStatusData?,
    currentConfig: CodeRagConfig?
) -> NSMenu {
    let menu = NSMenu()

    // 1. Title Item
    let titleItem = NSMenuItem(title: "P Code Indexing", action: nil, keyEquivalent: "")
    let titleFont = NSFont.boldSystemFont(ofSize: 13)
    titleItem.attributedTitle = NSAttributedString(string: "P Code Indexing", attributes: [.font: titleFont])
    titleItem.isEnabled = false
    menu.addItem(titleItem)

    // 2. Overall Status
    let statusText: String
    if !running {
        statusText = "Status: Stopped"
    } else if isIndexingActive {
        if let active = currentStatus?.repos.first(where: { $0.state == "indexing" }) {
            let repoName = URL(fileURLWithPath: active.path).lastPathComponent
            let pct = active.progress?.percent.map { "\(Int($0))%" } ?? "in progress"
            statusText = "Status: Indexing \(repoName) (\(pct))"
        } else {
            statusText = "Status: Indexing..."
        }
    } else {
        statusText = "Status: Ready (Idle)"
    }
    let statusMenuItem = NSMenuItem(title: "  " + statusText, action: nil, keyEquivalent: "")
    statusMenuItem.isEnabled = false
    menu.addItem(statusMenuItem)

    // 3. Compute Device
    let device = currentConfig?.embeddingDevice ?? "Auto"
    let mode = currentConfig?.searchMode == "bm25-only" ? "BM25 Fast" : "Hybrid (\(device))"
    let deviceItem = NSMenuItem(title: "  Device: \(mode)", action: nil, keyEquivalent: "")
    deviceItem.isEnabled = false
    menu.addItem(deviceItem)

    menu.addItem(NSMenuItem.separator())

    // 4. Repositories Section
    let repos = currentStatus?.repos ?? []
    if repos.isEmpty {
        let noRepos = NSMenuItem(title: "No repositories configured", action: nil, keyEquivalent: "")
        noRepos.isEnabled = false
        menu.addItem(noRepos)
    } else {
        let reposMenu = NSMenu()
        let reposItem = NSMenuItem(title: "Repositories (\(repos.count))", action: nil, keyEquivalent: "")
        reposItem.submenu = reposMenu

        for repo in repos {
            let repoName = URL(fileURLWithPath: repo.path).lastPathComponent
            let stateDesc: String
            if repo.state == "indexing" {
                let pct = repo.progress?.percent.map { " [\(Int($0))%]" } ?? ""
                stateDesc = "Indexing\(pct)"
            } else if repo.state == "error" {
                stateDesc = "Error"
            } else if repo.state == "queued" {
                stateDesc = "Queued"
            } else {
                stateDesc = "Ready (\(repo.indexedFiles) files)"
            }

            let repoSubmenu = NSMenu()
            let item = NSMenuItem(title: "\(repoName) - \(stateDesc)", action: nil, keyEquivalent: "")
            item.submenu = repoSubmenu

            let revealItem = NSMenuItem(title: "Reveal in Finder", action: Selector(("revealInFinder:")), keyEquivalent: "")
            revealItem.target = target
            revealItem.representedObject = repo.path
            repoSubmenu.addItem(revealItem)

            let terminalItem = NSMenuItem(title: "Open in Terminal", action: Selector(("openInTerminal:")), keyEquivalent: "")
            terminalItem.target = target
            terminalItem.representedObject = repo.path
            repoSubmenu.addItem(terminalItem)

            let reindexItem = NSMenuItem(title: "Prioritize / Re-index", action: Selector(("prioritizeRepo:")), keyEquivalent: "")
            reindexItem.target = target
            reindexItem.representedObject = repo.path
            repoSubmenu.addItem(reindexItem)

            reposMenu.addItem(item)
        }
        menu.addItem(reposItem)
    }

    menu.addItem(NSMenuItem.separator())

    // 5. Actions
    let reindexAllItem = NSMenuItem(title: "Reindex All Repositories", action: Selector(("reindexAll")), keyEquivalent: "")
    reindexAllItem.target = target
    reindexAllItem.isEnabled = running
    menu.addItem(reindexAllItem)

    let openLogsItem = NSMenuItem(title: "View Service Logs...", action: Selector(("openLogs")), keyEquivalent: "")
    openLogsItem.target = target
    menu.addItem(openLogsItem)

    let openConfigItem = NSMenuItem(title: "Open Configuration...", action: Selector(("openConfig")), keyEquivalent: "")
    openConfigItem.target = target
    menu.addItem(openConfigItem)

    let restartItem = NSMenuItem(title: "Restart Indexing Service", action: Selector(("restartService")), keyEquivalent: "r")
    restartItem.target = target
    menu.addItem(restartItem)

    menu.addItem(NSMenuItem.separator())

    // 6. Settings & Quit
    let disableItem = NSMenuItem(title: "Disable Tray Icon (from settings)", action: Selector(("disableTrayIcon")), keyEquivalent: "")
    disableItem.target = target
    menu.addItem(disableItem)

    let quitItem = NSMenuItem(title: "Quit Menu Bar App", action: Selector(("quitApp")), keyEquivalent: "q")
    quitItem.target = target
    menu.addItem(quitItem)

    return menu
}

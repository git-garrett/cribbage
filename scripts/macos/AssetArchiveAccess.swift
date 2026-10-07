// The folder picker is the only permission-granting path. Background operation
// resolves the saved grant without UI and fails closed if access is unavailable.
import AppKit
import Foundation

func run() throws -> Int32 {
    let args = Array(CommandLine.arguments.dropFirst())
    guard args.count >= 3, ["authorize", "access"].contains(args[0]) else {
        throw NSError(domain: "CribbageArchive", code: 1, userInfo: [NSLocalizedDescriptionKey:
            "Usage: AssetArchiveAccess authorize BOOKMARK DESTINATION | access BOOKMARK DESTINATION COMMAND [ARG ...]"])
    }
    let bookmarkFile = URL(fileURLWithPath: args[1])
    let expected = URL(fileURLWithPath: args[2]).standardizedFileURL.resolvingSymlinksInPath()
    if args[0] == "authorize" {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        app.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.title = "Allow automatic cribbage asset archiving"
        panel.message = "Choose the archive folder shown below. This saves permission for verified transfers while your Mac is locked."
        panel.prompt = "Allow Archive Folder"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = false
        panel.allowsMultipleSelection = false
        panel.directoryURL = expected
        guard panel.runModal() == .OK, let selected = panel.url else { return 2 }
        guard selected.standardizedFileURL.resolvingSymlinksInPath() == expected else {
            throw NSError(domain: "CribbageArchive", code: 2, userInfo: [NSLocalizedDescriptionKey:
                "Choose the configured archive folder: \(expected.path)"])
        }
        let data = try selected.bookmarkData(options: .withSecurityScope,
                                             includingResourceValuesForKeys: nil, relativeTo: nil)
        try data.write(to: bookmarkFile, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: bookmarkFile.path)
        print("Saved access to the selected archive folder.")
        return 0
    }
    guard args.count >= 4 else {
        throw NSError(domain: "CribbageArchive", code: 3, userInfo: [NSLocalizedDescriptionKey: "Missing archive command"])
    }
    let data = try Data(contentsOf: bookmarkFile)
    var stale = false
    let folder = try URL(resolvingBookmarkData: data, options: [.withSecurityScope, .withoutUI],
                         relativeTo: nil, bookmarkDataIsStale: &stale)
    guard !stale, folder.standardizedFileURL.resolvingSymlinksInPath() == expected,
          folder.startAccessingSecurityScopedResource() else {
        throw NSError(domain: "CribbageArchive", code: 4, userInfo: [NSLocalizedDescriptionKey:
            "Archive folder access is unavailable. Run authorization again while the Mac is unlocked."])
    }
    defer { folder.stopAccessingSecurityScopedResource() }
    let child = Process()
    child.executableURL = URL(fileURLWithPath: args[3])
    child.arguments = Array(args.dropFirst(4))
    child.standardInput = FileHandle.standardInput
    child.standardOutput = FileHandle.standardOutput
    child.standardError = FileHandle.standardError
    try child.run()
    child.waitUntilExit()
    return child.terminationStatus
}

do { exit(try run()) }
catch { fputs("Archive access failed: \(error.localizedDescription)\n", stderr); exit(1) }

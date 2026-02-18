import Foundation

public struct HookJob: Sendable {
    public let text: String
    public let timestamp: Date

    public init(text: String, timestamp: Date) {
        self.text = text
        self.timestamp = timestamp
    }
}

public actor HookExecutor {
    private let config: SwabbleConfig
    private var lastRun: Date?
    private let hostname: String
    private let logger: Logger

    public init(config: SwabbleConfig, logger: Logger? = nil) {
        self.config = config
        self.logger = logger ?? Logger(level: LogLevel(configValue: config.logging.level) ?? .info)
        hostname = Host.current().localizedName ?? "host"
    }

    public func shouldRun() -> Bool {
        guard config.hook.cooldownSeconds > 0 else { return true }
        if let lastRun, Date().timeIntervalSince(lastRun) < config.hook.cooldownSeconds {
            return false
        }
        return true
    }

    public func run(job: HookJob) async throws {
        guard shouldRun() else { return }
        let text = Self.normalized(job.text)
        let minCharacters = max(config.hook.minCharacters, 0)
        guard text.count >= minCharacters else {
            logger.info("hook skipped: text shorter than minCharacters (\(text.count)/\(minCharacters))")
            return
        }
        guard !config.hook.command.isEmpty else { throw NSError(
            domain: "Hook",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "hook command not set"]) }

        let prefix = config.hook.prefix.replacingOccurrences(of: "${hostname}", with: hostname)
        let payload = prefix + text

        let process = Process()
        process.executableURL = URL(fileURLWithPath: config.hook.command)
        process.arguments = config.hook.args + [payload]

        var env = ProcessInfo.processInfo.environment
        env["SWABBLE_TEXT"] = text
        env["SWABBLE_PREFIX"] = prefix
        for (k, v) in config.hook.env {
            env[k] = v
        }
        process.environment = env

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        try process.run()

        let timeoutNanos = UInt64(max(config.hook.timeoutSeconds, 0.1) * 1_000_000_000)
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
                process.waitUntilExit()
            }
            group.addTask {
                try await Task.sleep(nanoseconds: timeoutNanos)
                if process.isRunning {
                    process.terminate()
                }
            }
            try await group.next()
            group.cancelAll()
        }
        lastRun = Date()
    }

    nonisolated private static func normalized(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

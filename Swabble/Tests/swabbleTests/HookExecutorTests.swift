import Foundation
import Testing
@testable import Swabble

@Test
func hookExecutorSkipsShortTextBeforeCommandValidation() async throws {
    var config = SwabbleConfig()
    config.hook.command = ""
    config.hook.minCharacters = 5
    config.hook.cooldownSeconds = 0

    let executor = HookExecutor(config: config)
    try await executor.run(job: HookJob(text: "  hi  ", timestamp: Date()))
}

@Test
func hookExecutorThrowsWhenTextMeetsMinimumButCommandMissing() async {
    var config = SwabbleConfig()
    config.hook.command = ""
    config.hook.minCharacters = 5
    config.hook.cooldownSeconds = 0

    let executor = HookExecutor(config: config)

    var threw = false
    do {
        try await executor.run(job: HookJob(text: "  hello  ", timestamp: Date()))
    } catch {
        threw = true
    }

    #expect(threw)
}

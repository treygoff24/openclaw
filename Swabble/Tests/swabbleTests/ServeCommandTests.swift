import Foundation
import Testing
@testable import Swabble

@Test
func strippedTranscriptBelowMinimumDoesNotTriggerHookWhenCommandMissing() async throws {
    var config = SwabbleConfig()
    config.hook.command = ""
    config.hook.minCharacters = 4
    config.hook.cooldownSeconds = 0

    // Simulates ServeCommand stripWake result with leading/trailing spaces.
    let strippedTranscript = "  no  "
    let executor = HookExecutor(config: config)
    try await executor.run(job: HookJob(text: strippedTranscript, timestamp: Date()))
}

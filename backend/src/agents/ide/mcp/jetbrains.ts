export const jetbrainsMcpConfig = {
  name: 'JetBrains IDE',
  command: '/snap/intellij-idea-ultimate/current/jbr/bin/java',
  args: [
    '-classpath',
    '/snap/intellij-idea-ultimate/current/plugins/mcpserver/lib/mcpserver-frontend.jar:/snap/intellij-idea-ultimate/current/lib/util-8.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.kotlinx.coroutines.core.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.ktor.client.cio.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.ktor.client.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.ktor.network.tls.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.ktor.io.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.ktor.utils.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.kotlinx.io.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.kotlinx.serialization.core.jar:/snap/intellij-idea-ultimate/current/lib/intellij.libraries.kotlinx.serialization.json.jar',
    'com.intellij.mcpserver.stdio.McpStdioRunnerKt'
  ],
  env: { IJ_MCP_SERVER_PORT: '64342' },
  timeout: 60000,
};

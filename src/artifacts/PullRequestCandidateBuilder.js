export function buildPullRequestCandidate({ session, run, artifacts, title = null }) {
  const patchArtifacts = (artifacts || []).filter((artifact) => artifact.type === "patch" || /\.(patch|diff)$/i.test(artifact.relativePath || artifact.path || ""));
  if (!patchArtifacts.length) return null;
  const first = patchArtifacts[0];
  return {
    sessionId: session.id,
    runId: run.id,
    runtimeId: run.runtimeId,
    taskId: run.taskId || null,
    title: title || inferTitle(first),
    status: "candidate",
    artifactIds: patchArtifacts.map((artifact) => artifact.id),
    patchPaths: patchArtifacts.map((artifact) => artifact.relativePath || artifact.path),
    source: {
      platform: session.platform,
      workspaceId: session.workspaceId,
      channelId: session.channelId,
      threadId: session.threadId
    },
    metadata: {
      patchCount: patchArtifacts.length,
      artifactTypes: [...new Set(patchArtifacts.map((artifact) => artifact.type || "patch"))]
    }
  };
}

function inferTitle(artifact) {
  const name = String(artifact.relativePath || artifact.path || "OpenTag patch").split("/").pop();
  return `OpenTag patch: ${name}`;
}

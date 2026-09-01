interface CompletedGameUploadPolicy {
  remoteEnabled: boolean;
  localQaMode?: boolean;
  force: boolean;
  alreadyUploaded: boolean;
  playerTag: string;
}

export function shouldUploadCompletedGame({
  remoteEnabled,
  localQaMode = false,
  force,
  alreadyUploaded,
  playerTag,
}: CompletedGameUploadPolicy): boolean {
  if (localQaMode || !remoteEnabled || !playerTag.trim()) return false;
  return force || !alreadyUploaded;
}

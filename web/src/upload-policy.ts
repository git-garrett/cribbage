interface CompletedGameUploadPolicy {
  remoteEnabled: boolean;
  force: boolean;
  alreadyUploaded: boolean;
  playerTag: string;
}

export function shouldUploadCompletedGame({
  remoteEnabled,
  force,
  alreadyUploaded,
  playerTag,
}: CompletedGameUploadPolicy): boolean {
  if (!remoteEnabled || !playerTag.trim()) return false;
  return force || !alreadyUploaded;
}

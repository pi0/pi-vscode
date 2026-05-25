type WorkspaceFolderLike = { uri: { fsPath: string } };

type WorkspaceApi<TFolder extends WorkspaceFolderLike, TUri> = {
  workspaceFolders?: readonly TFolder[];
  getWorkspaceFolder(uri: TUri): TFolder | undefined;
};

type WindowApi<TUri> = {
  activeTextEditor?: { document: { uri: TUri } };
};

export function pickWorkspaceFolderPath<TFolder extends WorkspaceFolderLike>(
  workspaceFolders: readonly TFolder[] | undefined,
  activeWorkspaceFolder: TFolder | undefined,
): string | undefined {
  return activeWorkspaceFolder?.uri.fsPath ?? workspaceFolders?.[0]?.uri.fsPath;
}

export function getActiveWorkspaceFolderPath<TFolder extends WorkspaceFolderLike, TUri>(vscodeApi: {
  workspace: WorkspaceApi<TFolder, TUri>;
  window: WindowApi<TUri>;
}): string | undefined {
  const activeUri = vscodeApi.window.activeTextEditor?.document.uri;
  return pickWorkspaceFolderPath(
    vscodeApi.workspace.workspaceFolders,
    activeUri ? vscodeApi.workspace.getWorkspaceFolder(activeUri) : undefined,
  );
}

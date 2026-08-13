export function assertNoEvaluationArtifacts(input: {
  packagePath: string;
  source?: string;
}): void;

export function assertAllowedPackageFile(input: {
  packagePath: string;
  allowedPaths: Set<string>;
}): void;

export function assertAllowedBuildModule(input: {
  moduleId: string;
  projectRoot: string;
}): void;

export function collectLocalPageAssets(source: string): Set<string>;

export function assertNoRemoteStylesheetResources(
  source: string,
  packagePath: string,
): void;

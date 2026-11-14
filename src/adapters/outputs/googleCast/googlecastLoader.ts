export type GoogleCastModule = typeof import('@audioserver/node-googlecast');

let modulePromise: Promise<GoogleCastModule> | null = null;

export const loadGoogleCastModule = async (): Promise<GoogleCastModule> => {
  if (!modulePromise) {
    modulePromise = import('@audioserver/node-googlecast');
  }
  return modulePromise;
};

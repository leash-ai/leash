/**
 * Loader for @coti-io/coti-sdk-private-messaging.
 *
 * The package ships ESM only: its exports map declares an "import" condition and
 * no "require" one, so a plain top-level import from this CommonJS build fails at
 * resolution with ERR_PACKAGE_PATH_NOT_EXPORTED — which is what stopped
 * rentalListener from starting at all. Its subpaths are not exported either, so
 * reaching into dist/ directly is not an option.
 *
 * A real dynamic import loads ESM from CommonJS fine. The `new Function` wrapper
 * is deliberate and must stay: with module=commonjs, TypeScript rewrites a
 * literal `await import()` back into `require()`, which lands straight on the
 * failing path again.
 *
 * Types still resolve normally — moduleResolution node10 reads the package's
 * top-level "types" field and ignores the exports map, which is why this
 * typechecked while breaking at runtime.
 */
type PrivateMessagingSdk = typeof import("@coti-io/coti-sdk-private-messaging");

const esmImport = new Function("specifier", "return import(specifier)") as
  (specifier: string) => Promise<PrivateMessagingSdk>;

let pending: Promise<PrivateMessagingSdk> | undefined;

/** Load the SDK once and reuse it. */
export function privateMessagingSdk(): Promise<PrivateMessagingSdk> {
  pending ??= esmImport("@coti-io/coti-sdk-private-messaging");
  return pending;
}

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** What the build hands the browser runtime. */
export interface RuntimeConfig {
  /** Where the manifest is served; resolved against `document.baseURI`. */
  manifestUrl: string;
  /** True under the dev server: the manifest changes as files are edited, and files can open in the editor. */
  dev: boolean;
  /** Such as `alt+shift+k`. */
  hotkey: string;
  /** Where the character sits; `false` leaves only the hotkey. */
  launcher: Corner | false;
  /** Show the character in browsers driven by automation too; it is hidden there so it can't get in a test's way. */
  launcherUnderAutomation: boolean;
}

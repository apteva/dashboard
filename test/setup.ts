// Test bootstrap — loaded by bun test before any test file. Sets up
// the happy-dom DOM globals (window, document, etc.) so React + the
// testing-library renderer have a place to mount.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

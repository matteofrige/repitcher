// Release signing without committing secrets. The upload keystore is described by four Gradle
// properties, kept in the developer's ~/.gradle/gradle.properties (never in the repo):
//   REPITCH_UPLOAD_STORE_FILE, REPITCH_UPLOAD_STORE_PASSWORD,
//   REPITCH_UPLOAD_KEY_ALIAS,  REPITCH_UPLOAD_KEY_PASSWORD
// If they are all present the release build type is signed with that key; otherwise it keeps the
// debug signing the Expo template uses, so local `assembleRelease` still works.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @repitch-release-signing';

const SIGNING_CONFIG = `
        ${MARKER} (signingConfig)
        release {
            if (project.hasProperty('REPITCH_UPLOAD_STORE_FILE') &&
                project.hasProperty('REPITCH_UPLOAD_STORE_PASSWORD') &&
                project.hasProperty('REPITCH_UPLOAD_KEY_ALIAS') &&
                project.hasProperty('REPITCH_UPLOAD_KEY_PASSWORD')) {
                storeFile file(REPITCH_UPLOAD_STORE_FILE)
                storePassword REPITCH_UPLOAD_STORE_PASSWORD
                keyAlias REPITCH_UPLOAD_KEY_ALIAS
                keyPassword REPITCH_UPLOAD_KEY_PASSWORD
            }
        }
`;

const RELEASE_SIGNING = `signingConfig project.hasProperty('REPITCH_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug ${MARKER}`;

/** Index of the "}" closing the block whose opening "{" is at `open`. */
function closingBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function addSigningConfig(src) {
  const m = /signingConfigs\s*\{/.exec(src);
  if (!m) throw new Error('withAndroidReleaseSigning: signingConfigs block not found in app/build.gradle');
  const open = m.index + m[0].length - 1;
  const close = closingBrace(src, open);
  return src.slice(0, close) + SIGNING_CONFIG.replace(/\n$/, '') + '\n    ' + src.slice(close);
}

function useInReleaseBuildType(src) {
  const bt = /buildTypes\s*\{/.exec(src);
  if (!bt) throw new Error('withAndroidReleaseSigning: buildTypes block not found in app/build.gradle');
  const btOpen = bt.index + bt[0].length - 1;
  const btClose = closingBrace(src, btOpen);
  const block = src.slice(btOpen, btClose);
  const rel = /release\s*\{/.exec(block);
  if (!rel) throw new Error('withAndroidReleaseSigning: buildTypes.release not found in app/build.gradle');
  const relOpen = btOpen + rel.index + rel[0].length - 1;
  const relClose = closingBrace(src, relOpen);
  let body = src.slice(relOpen, relClose);
  if (/signingConfig\s+signingConfigs\.\w+/.test(body)) {
    body = body.replace(/signingConfig\s+signingConfigs\.\w+/, RELEASE_SIGNING);
  } else {
    body += `    ${RELEASE_SIGNING}\n        `;
  }
  return src.slice(0, relOpen) + body + src.slice(relClose);
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidReleaseSigning: app/build.gradle is not groovy');
    }
    let src = cfg.modResults.contents;
    if (!src.includes(MARKER)) {
      src = addSigningConfig(src);
      src = useInReleaseBuildType(src);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};

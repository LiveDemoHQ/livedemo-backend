# Third-Party Notices

This project is licensed under FSL-1.1-MIT (see [LICENSE](./LICENSE)). Some included dependencies may have different licenses.

## ffmpeg-static

- Package: `ffmpeg-static`
- Declared license: `GPL-3.0-or-later`
- Purpose in this project: provide FFmpeg binary fallback when system FFmpeg (`/usr/bin/ffmpeg`) is unavailable.

### Compliance Notes

If you distribute builds that include or rely on `ffmpeg-static` binaries, you should:

1. Include a copy of the GPL-3.0 license text with your distribution.
2. Provide access to corresponding source code for the FFmpeg binary you distribute (or a valid written offer, as required by GPLv3).
3. Keep this attribution and license notice in your distribution artifacts.

Helpful references:

- ffmpeg-static repository: https://github.com/eugeneware/ffmpeg-static
- ffmpeg-static package: https://www.npmjs.com/package/ffmpeg-static
- GNU GPL v3 text: https://www.gnu.org/licenses/gpl-3.0.txt
- FFmpeg sources: https://ffmpeg.org/download.html

### Repository helper

Run the following command to prepare a local copy of GPL text in `THIRD_PARTY_LICENSES`:

`npm run compliance:ffmpeg`

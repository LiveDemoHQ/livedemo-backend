import ScreenTypes from '../../constants/ScreenTypes.js'

export default function thumbnailForScreen(screen) {
    if (!screen) return ''
    if (screen.type === ScreenTypes.SCREEN_VIDEO) {
        const playbackId = screen.asset && screen.asset.playback_ids && screen.asset.playback_ids[0] && screen.asset.playback_ids[0].id
        return playbackId ? `https://image.mux.com/${playbackId}/thumbnail.png` : ''
    }
    return screen.imageUrl || ''
}

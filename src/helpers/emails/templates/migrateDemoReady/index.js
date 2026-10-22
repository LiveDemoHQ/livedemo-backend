import migrateDemoReady from './migrateDemoReady.js'
import migrateDemoReadyProps from './migrateDemoReady.props.js'

export default {
    data: migrateDemoReady,
    exampleProps: migrateDemoReadyProps,
    // Only the link: nothing the visitor typed ever reaches the email
    transformFunction: function ({ demoUrl }) {

        return { demoUrl }
    }
}

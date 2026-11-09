import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Breadcrumbs from './Breadcrumbs.vue'
import './custom.css'
import './custom-breadcrumb.css'
import '../../gallery/gallery.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'doc-before': () => h(Breadcrumbs),
  }),
} satisfies Theme

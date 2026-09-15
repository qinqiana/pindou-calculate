<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { bootAppLedger } from './src/platform/app-ledger'

onLaunch(() => {
  bootAppLedger()
})
</script>

<style>
page {
  background: #f6f1e7;
  color: #3a3228;
  font-size: 16px;
  line-height: 1.5;
}
</style>

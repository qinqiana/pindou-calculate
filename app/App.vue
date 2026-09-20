<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { bootAppLedger } from './src/platform/app-ledger'

onLaunch(async () => {
  await bootAppLedger()
})
</script>

<style>
page {
  background: #f7f3ea;
  color: #2f2a23;
  font-size: 28rpx;
  line-height: 1.55;
}
</style>

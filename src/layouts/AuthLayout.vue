<script setup lang="ts">
import BrandMark from '@/components/BrandMark.vue'
import LetterShowcase from '@/components/LetterShowcase.vue'
import PreferenceSwitches from '@/components/PreferenceSwitches.vue'
</script>

<template>
  <div class="auth">
    <aside class="side">
      <BrandMark />
      <LetterShowcase class="side-showcase" />
      <p class="tagline">{{ $t('app.tagline') }}</p>
    </aside>
    <main class="main">
      <header class="top">
        <BrandMark class="mobile-brand" size="sm" />
        <PreferenceSwitches />
      </header>
      <div class="form-wrap">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(420px, 46%) 1fr;
}
.side {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 40px;
  padding: 40px 48px;
  border-right: 1px solid var(--pl-line);
  background:
    radial-gradient(circle at 85% 12%, var(--pl-glow), transparent 45%),
    var(--pl-paper);
}
.side-showcase {
  align-self: center;
}
.tagline {
  margin: 0;
  color: var(--pl-muted);
  font-size: 0.875rem;
}
.main {
  display: flex;
  flex-direction: column;
  background: var(--pl-surface);
}
.top {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 16px 24px;
}
.mobile-brand {
  display: none;
  margin-right: auto;
}
.form-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px 64px;
}
@media (max-width: 900px) {
  .auth {
    grid-template-columns: 1fr;
  }
  .side {
    display: none;
  }
  .mobile-brand {
    display: inline-flex;
  }
  .form-wrap {
    align-items: flex-start;
    padding-top: 8vh;
  }
}
</style>

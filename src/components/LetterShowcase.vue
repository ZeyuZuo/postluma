<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// Sample addresses are data, not copy: vue-i18n would also parse "@" as linked-message syntax.
const SAMPLE_FROM = 'no-reply@example.org'
const SAMPLE_TO = 'maple.k7@example.com'

const { t, tm, rt } = useI18n()
</script>

<template>
  <div class="showcase">
    <article class="letter" aria-hidden="true">
      <svg class="postmark" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="30" />
        <circle cx="40" cy="40" r="23" />
        <path d="M-4 30q10-6 20 0t20 0 20 0 20 0 20 0M-4 40q10-6 20 0t20 0 20 0 20 0 20 0M-4 50q10-6 20 0t20 0 20 0 20 0 20 0" />
      </svg>
      <dl class="meta">
        <dt>{{ t('showcase.fromLabel') }}</dt>
        <dd>{{ SAMPLE_FROM }}</dd>
        <dt>{{ t('showcase.toLabel') }}</dt>
        <dd>{{ SAMPLE_TO }}</dd>
      </dl>
      <h2 class="subject">{{ t('showcase.subject') }}</h2>
      <p class="body">
        {{ t('showcase.before') }} <mark class="pl-mark code">482&#8239;913</mark>{{ t('showcase.after') }}
      </p>
    </article>
    <ul class="points">
      <li v-for="(point, i) in tm('showcase.points') as unknown[]" :key="i">{{ rt(point as string) }}</li>
    </ul>
  </div>
</template>

<style scoped>
.showcase {
  width: min(420px, 100%);
}
.letter {
  position: relative;
  background: var(--pl-surface);
  border: 1px solid var(--pl-line);
  border-radius: 10px;
  padding: 28px 28px 32px;
  box-shadow: 0 1px 0 var(--pl-line), 0 18px 40px -24px rgba(28, 36, 48, 0.35);
}
.postmark {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 72px;
  height: 72px;
  fill: none;
  stroke: var(--pl-blue);
  stroke-width: 1.5;
  opacity: 0.35;
  transform: rotate(-14deg);
}
.meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0 0 20px;
  font-size: 0.8125rem;
  color: var(--pl-muted);
}
.meta dd {
  margin: 0;
  font-family: var(--pl-mono);
  color: var(--pl-ink);
}
.subject {
  margin: 0 0 10px;
  font-size: 1.125rem;
  font-weight: 600;
}
.body {
  margin: 0;
  line-height: 1.7;
}
.code {
  font-size: 1.125em;
  letter-spacing: 0.04em;
  animation: draw 700ms 300ms cubic-bezier(0.3, 0.7, 0.2, 1) backwards;
}
@keyframes draw {
  from {
    background-size: 0% 78%;
  }
}
.points {
  list-style: none;
  margin: 28px 0 0;
  padding: 0;
  color: var(--pl-muted);
  line-height: 2;
}
.points li::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 12px;
  border-radius: 50%;
  background: var(--pl-blue);
  vertical-align: middle;
}
</style>

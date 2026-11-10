import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const lintScope = [
  'src/main.tsx',
  'src/app/App.tsx',
  'src/app/components/pwa/**/*.{ts,tsx}',
  'src/app/services/pwa*.ts',
  'src/app/AuthenticatedApp.tsx',
  'src/app/components/layout/**/*.{ts,tsx}',
  'src/app/components/workspace/**/*.{ts,tsx}',
  'src/app/pages/ads/components/AdsMonitoringFilters.tsx',
  'src/app/pages/ads/components/AdsMonitoringWorkspaceFrame.tsx',
  'src/app/pages/conversations/components/ConversationWorkspaceFrame.tsx',
  'src/app/pages/PlaceholderPage.tsx',
  'src/app/components/ui/NotificationBell.tsx',
  'src/app/pages/master-data/context/**/*.{ts,tsx}',
  'src/app/pages/master-data/data.ts',
  'src/app/pages/leads/socialContact.ts',
  'src/app/routing/**/*.ts',
  'src/app/pages/owner/OwnerAdsAnalytics.tsx',
  'src/app/services/orderScheduleValidation.ts',
  'src/app/services/internal/**/*.ts',
  'src/app/services/conversationCenterService.ts',
  'src/app/services/googleAdsLiveService.ts',
  'src/app/services/liveAdsService.ts',
  'src/app/services/masterDataService.ts',
  'src/app/services/orderPaymentService.ts',
  'src/app/services/tiktokAdsLiveService.ts',
  'src/lib/**/*.ts',
  'src/vite-env.d.ts',
  'utils/supabase/info.tsx',
];

export default [
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      '.tmp/**',
      'File Review/**',
      'guidelines/**',
      'supabase/.temp/**',
      '.wrangler/**',
      '.vscode/**',
    ],
  },
  {
    files: lintScope,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: ['src/vite-env.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];

// ESLint flat config（ESLint 9+）
// 规则说明：
//  - 消息处理器广泛使用 `any`（webview 消息结构），关闭 no-explicit-any；
//  - 函数参数（如 `(msg: any) => handler(host)`）允许不检查（args: 'none'），
//    未使用变量仍会被检查（varsIgnorePattern 放行 `_` 前缀）。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'media/**', 'tests/**']
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        varsIgnorePattern: '^_'
      }]
    }
  }
);

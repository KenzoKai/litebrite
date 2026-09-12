import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'outputs/**', 'components/ui/**'] },
  ...tseslint.configs.recommended,
);

export const EXECUTORCH_SMOKE_MANIFEST = {
  source:
    'https://huggingface.co/software-mansion/Qwen2.5-ExecuTorch',
  revision: 'ddc28846631f7ab1d3ffcae0e076cd7ef0061f39',
  directory: 'executorch-smoke/qwen2.5-0.5b',
  prompt: 'Reply with exactly: POCKETA_SMOKE_OK',
  cancelPrompt:
    'Write a long, detailed paragraph about saving money. Continue for several sentences.',
  model: {
    fileName: 'qwen_2_5_0_5b_xnnpack_8da4w.pte',
    bytes: 432_176_000,
    sha256:
      '8dc973a97af3f8551b47790b743ade2cd18d1102e619f67105435646821bc4ea',
  },
  tokenizer: {
    fileName: 'tokenizer.json',
    bytes: 7_031_645,
    sha256:
      'c0382117ea329cdf097041132f6d735924b697924d6f6fc3945713e96ce87539',
  },
  tokenizerConfig: {
    fileName: 'tokenizer_config.json',
    bytes: 7_305,
    sha256:
      '5b5d4f65d0acd3b2d56a35b56d374a36cbc1c8fa5cf3b3febbbfabf22f359583',
  },
} as const;

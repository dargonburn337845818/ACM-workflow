export type Platform = 'codeforces';

export interface Problem {
  id: string;
  platform: Platform;
  title: string;
  difficulty?: number;
  tags: string[];
  url: string;
  statement?: string;
  samples?: { input: string; output: string }[];
}

export interface AlgorithmTopic {
  id: number;
  name: string;
  range: string;
  essence: string;
  signal: string;
  tags: string[];
  basics: { label: string; text: string }[];
  tips: string[];
  bili: string[];
}

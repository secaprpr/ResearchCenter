import { describe, expect, it } from 'vitest';
import { formatVenue } from '../port/venue-display.js';

describe('发表来源展示格式', () => {
  it.each([
    ['NIPS', 'NeurIPS'], ['NeurIPS2021', 'NeurIPS'],
    ['Advances in Neural Information Processing Systems 35', 'NeurIPS'],
    ['2021 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)', 'CVPR'],
    ['2023 IEEE/CVF International Conference on Computer Vision (ICCV)', 'ICCV'],
    ['International Conference on Learning Representations', 'ICLR'],
    ['Proceedings of the 38th International Conference on Machine Learning', 'ICML'],
    ['European Conference on Computer Vision', 'ECCV'],
    ['Medical Image Computing and Computer-Assisted Intervention', 'MICCAI'],
    ['NAACL-HLT', 'NAACL-HLT'],
    ['Proceedings of the 2019 Conference on Empirical Methods in Natural Language Processing and the 9th International Joint Conference on Natural Language Processing (EMNLP-IJCNLP)', 'EMNLP-IJCNLP'],
  ])('将 %s 显示为 %s', (raw, label) => expect(formatVenue(raw)).toBe(label));
  it.each(['arXiv', 'arxiv', 'arXiv (Cornell University)', 'ArXiv e-prints', 'arXiv preprint arXiv:2301.12345', 'arXiv:2301.12345v2', 'https://arxiv.org/abs/2301.12345', 'https://export.arxiv.org/pdf/2301.12345', '10.48550/arXiv.2301.12345', 'CoRR abs/2301.12345'])('统一预印本来源 %s', raw => expect(formatVenue(raw)).toBe('arXiv'));
  it.each(['Nature Communications', 'The Lancet Digital Health', 'IEEE Transactions on Pattern Analysis and Machine Intelligence', 'CVPR Workshops 2025', 'Findings of ACL', 'ICCV Companion', 'NotNeurIPS', 'Journal of arXiv Studies', 'Unknown Conference on Something', 'MIDL'])('保留未知名称、期刊和伴随会议：%s', raw => expect(formatVenue(raw)).toBe(raw));
  it('空值保留为空，便于界面显示缺失状态', () => { expect(formatVenue('')).toBe(''); expect(formatVenue(null)).toBe(''); });
});

import type { RecordItem } from './types';
import { emptyTopic } from './topics';
import type { ResearchTask, TaskCategory, TaskEvent, TaskStatus } from './research-tasks';

export const LINEAGE_DEMO_ID = 'demo-research-lineage-v1';
export function buildLineageDemo(typeId: string, workspaceId: string, categories: TaskCategory[]): RecordItem {
  const at = (date: string) => Date.parse(`2026-10-${date}:00+08:00`);
  const id = (name: string) => `${LINEAGE_DEMO_ID}:${name}`;
  const event = (name: string, title: string, time: string, values: [string, string][] = [], status?: TaskStatus): TaskEvent => ({
    id:id(name),title,description:'',occurredAt:at(time),recordedAt:at(time),source:'演示',evidence:'',templateId:'',templateVersion:1,
    fields:values.map(([label,value],i)=>({id:`field-${i}`,label,value,type:value.startsWith('/demo/')?'path':'text'})),...(status?{status}:{})
  });
  const task = (name: string, title: string, nodeType: string, time: string, parents: string[], tags: string[], events: TaskEvent[], extra: Partial<ResearchTask> = {}): ResearchTask => ({
    id:id(name),title,nodeType,description:'',categoryIds:tags.filter(tag=>categories.some(c=>c.id===tag)),parentIds:parents.map(id),status:'completed',
    createdAt:at(time),updatedAt:events.at(-1)?.occurredAt||at(time),recordedAt:at(time),source:'演示',notes:'',events,assetIds:[],paperIds:[],links:[],comments:[],...extra
  });
  const tasks = [
    task('question','病理与分子信息能否改善跨中心预测？','研究问题','21T09:30',[],[],[
      event('question-1','确定第一轮研究范围','21T09:30',[['主要问题','跨中心泛化'],['验证思路','病理基线 → 多模态探索 → 外部验证']])
    ],{nodeStyle:'milestone',description:'用一轮可复现的探索，判断分子信息是否带来稳定增益。此课题内的内容均为测试数据。'}),
    task('download','下载 TCGA-BRCA，建立探索数据底座','数据下载','22T10:05',['question'],['data','download'],[
      event('download-1','开始下载','22T10:05',[['下载来源','TCGA GDC Portal（演示）'],['保存位置','/demo/data/tcga/brca'],['执行方式','gdc-client']], 'running'),
      event('download-2','下载进度更新','22T16:40',[['进度','68%'],['已下载','816 GB'],['剩余批次','3']]),
      event('download-3','下载完成并校验','23T09:05',[['文件数量','2,418'],['总大小','1.2 TB'],['完整性检查','通过'],['实际保存位置','/demo/data/tcga/brca']], 'completed')
    ],{description:'准备病理图像和临床信息，保留来源、保存位置与完整性检查。',notes:'演示路径和数量，仅用于观察字段胶囊与时间线。'}),
    task('clean','建立患者、切片与临床信息的对应关系','数据整理','23T10:20',['download'],['data','processing'],[
      event('clean-1','检查原始清单','23T10:20',[['输入清单','/demo/data/tcga/manifest.tsv'],['发现问题','部分患者存在重复切片']]),
      event('clean-2','冻结第一版数据清单','23T17:30',[['数据版本','BRCA v1'],['有效患者','982'],['输出清单','/demo/data/brca/cohort_v1.csv']],'completed')
    ],{description:'统一标识和划分，给后续并行实验提供同一份输入。'}),
    task('baseline','建立可复现的病理基线','基线实验','24T09:10',['clean'],['experiment','baseline'],[
      event('baseline-1','启动基线训练','24T09:10',[['模型','MIL · ResNet50'],['配置','/demo/config/baseline.yaml'],['随机种子','42']],'running'),
      event('baseline-2','基线训练完成','24T19:40',[['验证 AUROC','0.812（示例）'],['结果位置','/demo/results/baseline'],['代码版本','demo-a13f2']],'completed')
    ],{description:'固定病理单模态参照，后续探索使用相同划分。',content:'## 基线记录\n\n- 数据：BRCA v1\n- 固定随机种子与患者级划分。\n- 后续比较需要核查中心分布。\n\n> [!important] 演示结果\n> 指标和路径为测试内容。'}),
    task('external','并行准备外部中心验证','外部验证','24T11:00',['clean'],['data','processing'],[
      event('external-1','核查外部中心数据','24T11:00',[['验证中心','中心 B'],['检查项目','标识、染色、缺失值']],'running'),
      event('external-2','完成首轮外部评估','26T18:20',[['外部 AUROC','0.754（示例）'],['观察','中心间表现存在差异']],'completed')
    ],{branch:true,description:'与模型探索并行，避免只根据内部验证判断效果。'}),
    task('multimodal','从病理基线分出多模态方案','方案探索','25T10:00',['baseline'],['experiment','tuning'],[
      event('multimodal-1','加入分子特征分支','25T10:00',[['融合方式','晚期融合'],['配置','/demo/config/multimodal.yaml']],'running'),
      event('multimodal-2','完成多模态探索','26T09:40',[['验证 AUROC','0.837（示例）'],['下一步','核查增益来源']],'completed')
    ],{branch:true,description:'增加分子信息，保留与基线一致的预处理和划分。'}),
    task('ablation','核对分子分支的增益来源与稳定性','消融实验','26T10:30',['multimodal'],['experiment','ablation'],[
      event('ablation-1','启动多种子消融','26T10:30',[['对照','移除分子分支'],['随机种子','42 / 123 / 2026']],'running'),
      event('ablation-2','完成对照与复核','27T11:20',[['结论','增益方向一致（示例）'],['待复核','外部中心的误差分布']],'completed')
    ],{description:'排除随机种子与参数规模造成的偶然差异。'}),
    task('stain','暂缓染色归一化探索','备选方案','26T13:00',['baseline'],['experiment','tuning'],[
      event('stain-1','尝试染色归一化','26T13:00',[['方法','Macenko（演示）']],'running'),
      event('stain-2','暂缓独立探索','27T09:00',[['原因','先固定主方案，避免同时改动过多变量'],['恢复条件','外部误差分析提示明显染色差异']],'paused')
    ],{branch:true,status:'paused',description:'保留尝试的理由与暂缓原因，后续可以从这里继续。'}),
    task('decision','汇合结论：保留多模态方案，补充外部验证','研究决定','27T15:15',['ablation','external'],['analysis','results'],[
      event('decision-1','汇合实验与外部证据','27T15:15',[['依据','基线、消融与外部评估'],['决定','保留多模态方向'],['后续','补充误差分层分析']])
    ],{nodeStyle:'milestone',description:'将两条探索路径汇合为一次明确判断，保留当时的证据和下一步。'}),
    task('release','冻结第一轮研究版本','研究快照','28T18:20',['decision'],[],[
      event('release-1','整理版本产物','28T18:20',[['数据版本','BRCA v1'],['配置版本','multimodal v1'],['结果目录','/demo/releases/v0.1'],['复现检查','通过']])
    ],{nodeStyle:'snapshot',version:'v0.1',description:'演示一个阶段版本节点，关联本轮配置、结果位置与判断。'}),
    task('maintenance','修正中心 B 的样本映射，重跑受影响实验','日常维护','29T10:10',['release'],['data','processing'],[
      event('maintenance-1','发现样本映射问题','29T10:10',[['发现','少量样本标识重复'],['影响范围','中心 B 外部验证']]),
      event('maintenance-2','修正清单并启动重跑','29T16:30',[['新数据版本','BRCA v1.1'],['进度','重跑中'],['结果位置','/demo/results/external-rerun']],'running')
    ],{branch:true,status:'running',description:'日常修正也保留在研究脉络中，明确修正原因和影响范围。'}),
    task('next','复核修正结果，更新下一轮研究版本','阶段更新','29T17:00',['release','maintenance'],[],[
      event('next-1','记录后续工作','29T17:00',[['前置条件','完成重跑与样本复核'],['待整理','修正前后结果对比']],'pending')
    ],{nodeStyle:'snapshot',version:'v0.2',status:'pending',description:'等待维护分支完成后汇合，不把尚未完成的工作标成完成。'})
  ];
  return {id:LINEAGE_DEMO_ID,typeId,workspaceId,title:'演示 · 多模态病理研究',content:'',status:'active',starred:false,archived:false,fields:[],priority:'none',dueDate:null,done:false,planDate:null,planStart:null,planEnd:null,createdAt:at('21T09:30'),updatedAt:at('29T17:00'),topic:{...emptyTopic(),question:'从数据准备到并行实验、阶段结论与后续维护。',tasks}};
}

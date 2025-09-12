import type { VfsEntry } from '../api/client';

export interface AppComponentProps {
  filePath: string;
  entry: VfsEntry;
  onRequestClose: () => void;
}

export interface AppDescriptor {
  key: string;
  name: string;
  supported: (entry: VfsEntry) => boolean;
  component: React.ComponentType<AppComponentProps>;
  iconUrl?: string;
  default?: boolean;
  defaultMaximized?: boolean;
  /**
   * 应用窗口的默认位置与尺寸（非最大化时生效）
   * 任意字段缺省则按系统默认/级联偏移。
   */
  defaultBounds?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  // 新增：是否使用系统窗口（带标题栏、拖拽与缩放）
  // 默认为 true；若设为 false 则渲染为无壳的嵌入式视图。
  useSystemWindow?: boolean;
}

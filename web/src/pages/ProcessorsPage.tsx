import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  message,
  Modal,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
  theme,
} from 'antd';
import Editor from '@monaco-editor/react';
import PageCard from '../components/PageCard';
import { ProcessorConfigForm } from '../components/ProcessorConfigForm';
import PathSelectorModal, { type PathSelectorMode } from '../components/PathSelectorModal';
import { processorsApi, type ProcessorTypeMeta } from '../api/processors';
import { useI18n } from '../i18n';

const { Text } = Typography;

type TabKey = 'editor' | 'runner';

const ProcessorsPage = memo(function ProcessorsPage() {
  const { t } = useI18n();
  const { token } = theme.useToken();
  const [processors, setProcessors] = useState<ProcessorTypeMeta[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('');
  const [source, setSource] = useState('');
  const [initialSource, setInitialSource] = useState('');
  const [modulePath, setModulePath] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [form] = Form.useForm();
  const [running, setRunning] = useState(false);
  const [isDirectory, setIsDirectory] = useState(false);
  const [pathModalOpen, setPathModalOpen] = useState(false);
  const [pathModalMode, setPathModalMode] = useState<PathSelectorMode>('file');
  const [pathModalField, setPathModalField] = useState<'path' | 'save_to'>('path');
  const [activeTab, setActiveTab] = useState<TabKey>('editor');

  const isDirty = source !== initialSource;

  const selectedProcessorMeta = useMemo(
    () => processors.find(p => p.type === selectedType),
    [processors, selectedType]
  );

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await processorsApi.list();
      setProcessors(list);
    } catch (err: any) {
      message.error(err?.message || t('Load failed'));
    } finally {
      setLoadingList(false);
    }
  }, [t]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!processors.length) {
      setSelectedType('');
      return;
    }
    if (!selectedType) {
      setSelectedType(processors[0].type);
    } else if (!processors.some(p => p.type === selectedType)) {
      setSelectedType(processors[0].type);
    }
  }, [processors, selectedType]);

  useEffect(() => {
    if (!selectedType) {
      setSource('');
      setInitialSource('');
      setModulePath('');
      return;
    }
    const controller = new AbortController();
    setSource('');
    setInitialSource('');
    setModulePath('');
    setSourceLoading(true);
    processorsApi.getSource(selectedType)
      .then(resp => {
        if (controller.signal.aborted) return;
        setSource(resp.source ?? '');
        setInitialSource(resp.source ?? '');
        setModulePath(resp.module_path ?? '');
      })
      .catch((err: any) => {
        if (controller.signal.aborted) return;
        message.error(err?.message || t('Load failed'));
        setSource('');
        setInitialSource('');
        setModulePath('');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSourceLoading(false);
        }
      });
    return () => controller.abort();
  }, [selectedType, t]);

  useEffect(() => {
    form.resetFields();
    const defaults: Record<string, any> = {};
    selectedProcessorMeta?.config_schema?.forEach(field => {
      if (field.default !== undefined) {
        defaults[field.key] = field.default;
      }
    });
    form.setFieldsValue({
      path: '',
      overwrite: !!selectedProcessorMeta?.produces_file,
      save_to: undefined,
      config: defaults,
    });
    setIsDirectory(false);
  }, [selectedProcessorMeta, form]);

  const overwriteValue = Form.useWatch('overwrite', form) ?? false;

  useEffect(() => {
    if (overwriteValue) {
      form.setFieldsValue({ save_to: undefined });
    }
  }, [overwriteValue, form]);

  useEffect(() => {
    if (isDirectory) {
      form.setFieldsValue({ overwrite: true, save_to: undefined });
    }
  }, [isDirectory, form]);

  const handleSelectProcessor = useCallback((type: string) => {
    if (type === selectedType) return;
    if (isDirty) {
      Modal.confirm({
        title: t('Unsaved changes'),
        content: t('Switching processor will discard unsaved changes. Continue?'),
        okText: t('Confirm'),
        cancelText: t('Cancel'),
        onOk: () => {
          setSelectedType(type);
          setActiveTab('editor');
        },
      });
    } else {
      setSelectedType(type);
      setActiveTab('editor');
    }
  }, [isDirty, selectedType, t]);

  const handleSaveSource = useCallback(async () => {
    if (!selectedType) return;
    try {
      setSavingSource(true);
      await processorsApi.updateSource(selectedType, source);
      setInitialSource(source);
      message.success(t('Source saved'));
    } catch (err: any) {
      message.error(err?.message || t('Operation failed'));
    } finally {
      setSavingSource(false);
    }
  }, [selectedType, source, t]);

  const handleReloadProcessors = useCallback(async () => {
    try {
      setReloading(true);
      await processorsApi.reload();
      message.success(t('Processors reloaded'));
      await loadList();
    } catch (err: any) {
      message.error(err?.message || t('Operation failed'));
    } finally {
      setReloading(false);
    }
  }, [loadList, t]);

  const openPathSelector = useCallback((field: 'path' | 'save_to', mode: PathSelectorMode) => {
    setPathModalField(field);
    setPathModalMode(mode);
    setPathModalOpen(true);
  }, []);

  const handlePathSelected = useCallback((selectedPath: string) => {
    if (pathModalField === 'path') {
      form.setFieldsValue({ path: selectedPath });
      setIsDirectory(pathModalMode === 'directory');
    } else {
      form.setFieldsValue({ save_to: selectedPath });
    }
    setPathModalOpen(false);
  }, [form, pathModalField, pathModalMode]);

  const handleRun = useCallback(async () => {
    if (!selectedType) {
      message.warning(t('Please select a processor'));
      return;
    }
    try {
      const values = await form.validateFields();
      const schema = selectedProcessorMeta?.config_schema || [];
      const finalConfig: Record<string, any> = {};
      schema.forEach(field => {
        const value = values.config?.[field.key];
        if (value === undefined) {
          finalConfig[field.key] = field.default;
        } else {
          finalConfig[field.key] = value;
        }
      });
      setRunning(true);
      const payload: any = {
        path: values.path,
        processor_type: selectedType,
        config: finalConfig,
        overwrite: !!values.overwrite,
      };
      if (values.save_to && !values.overwrite) {
        payload.save_to = values.save_to;
      }
      const resp = await processorsApi.process(payload);
      message.success(`${t('Task submitted')}: ${resp.task_id}`);
    } catch (err: any) {
      if (err?.errorFields) {
        return;
      }
      message.error(err?.message || t('Operation failed'));
    } finally {
      setRunning(false);
    }
  }, [form, selectedProcessorMeta, selectedType, t]);

  const selectedConfigPath = pathModalField === 'path'
    ? form.getFieldValue('path') || '/'
    : form.getFieldValue('save_to') || '/';

  const renderProcessorList = () => {
    if (loadingList) {
      return (
        <Flex align="center" justify="center" style={{ height: '100%' }}>
          <Spin />
        </Flex>
      );
    }
    if (!processors.length) {
      return (
        <Flex align="center" justify="center" style={{ height: '100%' }}>
          <Empty description={t('No data')} />
        </Flex>
      );
    }
    return (
      <div style={{ padding: 8, overflowY: 'auto', height: '100%' }}>
        {processors.map(item => {
          const selected = item.type === selectedType;
          const onClick = () => handleSelectProcessor(item.type);
          return (
            <div
              key={item.type}
              onClick={onClick}
              style={{
                border: `1px solid ${selected ? token.colorPrimary : token.colorBorderSecondary}`,
                background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                borderRadius: 10,
                padding: 12,
                marginBottom: 8,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <Flex justify="space-between" align="center">
                <Space size={8} align="center">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: selected ? token.colorPrimary : token.colorBorderSecondary,
                      display: 'inline-block',
                    }}
                  />
                  <Text strong>{item.name}</Text>
                </Space>
                <Tag color={selected ? token.colorPrimary : token.colorBorderSecondary}>{item.type}</Tag>
              </Flex>
              <Space direction="vertical" size={6} style={{ marginTop: 8 }}>
                <div>
                  <Text type="secondary" style={{ marginRight: 8 }}>{t('Supported Extensions')}:</Text>
                  {item.supported_exts?.length ? (
                    <Space wrap size={[4, 4]}>
                      {item.supported_exts.map(ext => (
                        <Tag key={ext}>{ext}</Tag>
                      ))}
                    </Space>
                  ) : (
                    <Tag>{t('All')}</Tag>
                  )}
                </div>
                <Text type="secondary">
                  {t('Produces File')}: {item.produces_file ? t('Yes') : t('No')}
                </Text>
              </Space>
            </div>
          );
        })}
      </div>
    );
  };

  const tabs = [
    {
      key: 'editor',
      label: t('Source Editor'),
      children: selectedType ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
            {modulePath ? (
              <Space size={8}>
                <Text type="secondary">{t('Module Path')}:</Text>
                <Text code>{modulePath}</Text>
              </Space>
            ) : (
              <Text type="secondary">{t('No module path')}</Text>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {sourceLoading ? (
              <Flex align="center" justify="center" style={{ height: '100%' }}>
                <Spin />
              </Flex>
            ) : (
              <Editor
                language="python"
                value={source}
                onChange={(val) => setSource(val ?? '')}
                height="100%"
                options={{
                  automaticLayout: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                }}
              />
            )}
          </div>
        </div>
      ) : (
        <Empty style={{ marginTop: 64 }} description={t('Select a processor')} />
      ),
    },
    {
      key: 'runner',
      label: t('Run Processor'),
      children: selectedType ? (
        <Form form={form} layout="vertical" disabled={!selectedType} style={{ padding: '12px 0' }}>
          {isDirectory && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              {t('Directory processing always overwrites original files')}
            </Text>
          )}
          <Form.Item
            name="path"
            label={t('Target Path')}
            rules={[{ required: true, message: t('Please select a path') }]}
          >
            <Flex gap={8} align="center">
              <Input placeholder={t('Select a path')} style={{ flex: 1 }} />
              <Button onClick={() => openPathSelector('path', 'file')}>{t('Select File')}</Button>
              <Button onClick={() => openPathSelector('path', 'directory')}>{t('Select Directory')}</Button>
            </Flex>
          </Form.Item>

          <Form.Item
            name="overwrite"
            label={t('Overwrite original')}
            valuePropName="checked"
          >
            <Switch disabled={isDirectory} />
          </Form.Item>

          {selectedProcessorMeta?.produces_file && !overwriteValue && (
            <Form.Item
              name="save_to"
              label={t('Save To')}
            >
              <Flex gap={8} align="center">
                <Input placeholder={t('Optional output path')} style={{ flex: 1 }} />
                <Button onClick={() => openPathSelector('save_to', 'any')}>{t('Select')}</Button>
              </Flex>
            </Form.Item>
          )}

          <ProcessorConfigForm
            processorMeta={selectedProcessorMeta}
            form={form}
            configPath={['config']}
          />

          <Form.Item>
            <Button type="primary" onClick={handleRun} loading={running} disabled={!selectedType}>
              {t('Run')}
            </Button>
          </Form.Item>
        </Form>
      ) : (
        <Empty style={{ marginTop: 64 }} description={t('Select a processor')} />
      ),
    },
  ];

  return (
    <PageCard title={t('Processors')}>
      <Flex gap={16} style={{ height: '100%' }}>
        <Card
          style={{ flex: '0 0 320px', minWidth: 280, display: 'flex', flexDirection: 'column' }}
          title={t('Processor List')}
          extra={
            <Space size={8}>
              <Button size="small" onClick={loadList} loading={loadingList}>{t('Refresh')}</Button>
              <Button size="small" onClick={handleReloadProcessors} loading={reloading}>{t('Reload')}</Button>
            </Space>
          }
          styles={{ body: { padding: 0, flex: 1, display: 'flex' } }}
        >
          {renderProcessorList()}
        </Card>

        <Card
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
          title={selectedProcessorMeta ? `${selectedProcessorMeta.name} (${selectedProcessorMeta.type})` : t('Select a processor')}
          extra={
            <Space size={8}>
              <Button size="small" onClick={handleSaveSource} loading={savingSource} disabled={!selectedType || !isDirty}>
                {t('Save')}
              </Button>
              <Button size="small" onClick={handleReloadProcessors} loading={reloading} disabled={!selectedType}>
                {t('Reload')}
              </Button>
            </Space>
          }
          styles={{ body: { padding: 0, flex: 1, display: 'flex', flexDirection: 'column' } }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={key => setActiveTab(key as TabKey)}
            items={tabs as any}
            className="processors-tabs"
            tabBarGutter={32}
          />
        </Card>
      </Flex>

      <PathSelectorModal
        open={pathModalOpen}
        mode={pathModalMode}
        initialPath={selectedConfigPath}
        onOk={handlePathSelected}
        onCancel={() => setPathModalOpen(false)}
      />
    </PageCard>
  );
});

export default ProcessorsPage;

'use client'

import { useState } from 'react'
import { PipelineControls } from '@/components/PipelineControls'
import { RecentRuns } from '@/components/RecentRuns'
import { ServicesPanel } from '@/components/ServicesPanel'
import { NemotronChat } from '@/components/NemotronChat'
import { CostPanel } from '@/components/CostPanel'
import { ProduceVideoPanel } from '@/components/ProduceVideoPanel'
import { EnhanceFootagePanel } from '@/components/EnhanceFootagePanel'
import { ProjectsPanel } from '@/components/ProjectsPanel'
import { AdaptivePipelinePanel } from '@/components/AdaptivePipelinePanel'
import { ValidationPanel } from '@/components/ValidationPanel'

type Tab = 'pipeline' | 'validation'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pipeline',   label: 'Pipeline' },
  { id: 'validation', label: 'Validation' },
]

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('pipeline')
  const [selectedProject, setSelectedProject] = useState<string>('')

  const handleRunComplete = (sessionDirName: string) => {
    setSelectedProject(sessionDirName)
    setActiveTab('validation')
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-black tracking-widest uppercase">
              SPLICE<span className="text-brand-red">WERK</span>
            </span>
            <span className="text-text-subtle text-xs font-medium tracking-wider uppercase">
              Pipeline Dashboard
            </span>
          </div>
          <nav className="flex items-center gap-6">
            <a
              href="http://localhost:8288"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors tracking-wide uppercase"
            >
              Inngest
            </a>
            <a
              href="http://localhost:8288/runs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors tracking-wide uppercase"
            >
              Runs
            </a>
            <a
              href="http://localhost:8288/functions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors tracking-wide uppercase"
            >
              Functions
            </a>
          </nav>
        </div>
      </header>

      {/* Tab bar */}
      <div className="border-b border-border bg-background/90 backdrop-blur-sm sticky top-14 z-40">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-1 -mb-px">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  px-4 py-3 text-xs font-semibold tracking-widest uppercase transition-colors border-b-2
                  ${activeTab === tab.id
                    ? 'border-brand-red text-text-primary'
                    : 'border-transparent text-text-muted hover:text-text-primary'}
                `}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main layout */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        {activeTab === 'pipeline' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Left column */}
            <div className="xl:col-span-2 flex flex-col gap-6">
              <AdaptivePipelinePanel />
              <EnhanceFootagePanel onRunComplete={handleRunComplete} />
              <ProduceVideoPanel />
              <ProjectsPanel />
              <PipelineControls />
              <RecentRuns />
              <CostPanel />
              <ServicesPanel />
            </div>

            {/* Right column */}
            <div className="xl:col-span-1">
              <NemotronChat />
            </div>
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Left column */}
            <div className="xl:col-span-2 flex flex-col gap-6">
              <ValidationPanel projectName={selectedProject} />
            </div>

            {/* Right column */}
            <div className="xl:col-span-1">
              <NemotronChat />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

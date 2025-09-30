import { useState } from 'react'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

interface DataImportProps {
  onClose: () => void
  onImportComplete: () => void
}

interface EquipmentLog {
  equipment_name: string
  timestamp: string
  status: string
  reason?: string
  duration_minutes?: number
  issue?: string
  alert?: string
}

export function DataImport({ onClose, onImportComplete }: DataImportProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')
  const [previewData, setPreviewData] = useState<EquipmentLog[]>([])
  const [errorMessage, setErrorMessage] = useState('')

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setErrorMessage('Please upload an Excel file (.xlsx or .xls)')
      setUploadStatus('error')
      return
    }

    setIsUploading(true)
    setUploadStatus('processing')
    setErrorMessage('')

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]

      // Assume first row is headers
      const headers = jsonData[0] as string[]
      const rows = jsonData.slice(1)

      // Map to our expected format
      const equipmentLogs: EquipmentLog[] = rows.map(row => {
        const log: any = {}
        headers.forEach((header, index) => {
          const normalizedHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '_')
          log[normalizedHeader] = row[index]
        })

        return {
          equipment_name: log.equipment_name || log.equipment || log.machine || log.machine_name || `Equipment_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: log.timestamp || log.time || log.date || new Date().toISOString(),
          status: log.status || log.state || 'unknown',
          reason: log.reason || log.cause || undefined,
          duration_minutes: parseInt(log.duration_minutes || log.duration || '0') || 0,
          issue: log.issue || log.problem || log.description || undefined,
          alert: log.alert || log.alarm || log.notification || undefined
        }
      }).filter(log => log.equipment_name && log.status) // Filter out invalid rows

      setPreviewData(equipmentLogs.slice(0, 5)) // Show first 5 rows as preview
      setUploadStatus('success')

      if (equipmentLogs.length === 0) {
        setErrorMessage('No valid equipment data found in the Excel file. Please check the format.')
        setUploadStatus('error')
        return
      }

      // Import data to database
      await importToDatabase(equipmentLogs)

    } catch (error) {
      console.error('Error processing Excel file:', error)
      setErrorMessage('Error processing Excel file. Please check the file format.')
      setUploadStatus('error')
    } finally {
      setIsUploading(false)
    }
  }

  const importToDatabase = async (logs: EquipmentLog[]) => {
    try {
      // Clear existing data first (optional - remove this if you want to append)
      await supabase.from('equipment_status_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')

      // Insert new data in batches
      const batchSize = 100
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize)
        const { error } = await supabase
          .from('equipment_status_logs')
          .insert(batch)

        if (error) {
          console.error('Error inserting batch:', error)
          throw error
        }
      }

      // Update equipment table with unique equipment names
      const uniqueEquipment = [...new Set(logs.map(log => log.equipment_name))]
      const equipmentRecords = uniqueEquipment.map(name => ({
        name,
        type: 'Production Equipment',
        location: 'Production Floor',
        model: 'Model TBD'
      }))

      await supabase.from('equipment').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      const { error: equipError } = await supabase
        .from('equipment')
        .insert(equipmentRecords)

      if (equipError) {
        console.error('Error inserting equipment:', equipError)
      }

      onImportComplete()
    } catch (error) {
      console.error('Error importing to database:', error)
      setErrorMessage('Error importing data to database. Please try again.')
      setUploadStatus('error')
    }
  }

  const getExpectedFormat = () => (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
      <h4 className="font-medium text-gray-900 mb-2">Expected Excel Format:</h4>
      <div className="text-sm text-gray-600 space-y-1">
        <p><strong>Required columns:</strong></p>
        <ul className="list-disc list-inside ml-2 space-y-1">
          <li><code>equipment_name</code> or <code>equipment</code> or <code>machine</code></li>
          <li><code>status</code> or <code>state</code> (e.g., "running", "down", "maintenance")</li>
          <li><code>timestamp</code> or <code>time</code> or <code>date</code></li>
        </ul>
        <p><strong>Optional columns:</strong></p>
        <ul className="list-disc list-inside ml-2 space-y-1">
          <li><code>duration_minutes</code> or <code>duration</code></li>
          <li><code>reason</code> or <code>cause</code></li>
          <li><code>issue</code> or <code>problem</code></li>
          <li><code>alert</code> or <code>alarm</code></li>
        </ul>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Import Equipment Data</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            {uploadStatus === 'idle' && (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <FileSpreadsheet className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <div className="space-y-2">
                  <h4 className="text-lg font-medium text-gray-900">Upload Excel File</h4>
                  <p className="text-gray-600">Select your equipment data Excel file (.xlsx or .xls)</p>
                </div>
                <div className="mt-4">
                  <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors" style={{ backgroundColor: '#1955AE' }}>
                    <Upload className="w-4 h-4" />
                    Choose File
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                {getExpectedFormat()}
              </div>
            )}

            {uploadStatus === 'processing' && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4" style={{ borderColor: '#1955AE' }}></div>
                <p className="text-gray-600">Processing Excel file...</p>
              </div>
            )}

            {uploadStatus === 'success' && previewData.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Data imported successfully!</span>
                </div>

                <div className="bg-green-50 p-4 rounded-lg">
                  <h4 className="font-medium text-green-900 mb-2">Preview of imported data:</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-green-200">
                          <th className="text-left p-2">Equipment</th>
                          <th className="text-left p-2">Status</th>
                          <th className="text-left p-2">Duration</th>
                          <th className="text-left p-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.map((log, index) => (
                          <tr key={index} className="border-b border-green-100">
                            <td className="p-2">{log.equipment_name}</td>
                            <td className="p-2">{log.status}</td>
                            <td className="p-2">{log.duration_minutes || 0} min</td>
                            <td className="p-2">{log.reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="flex-1 px-4 py-2 text-white rounded-lg transition-colors"
                    style={{ backgroundColor: '#1955AE' }}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {uploadStatus === 'error' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="w-5 h-5" />
                  <span className="font-medium">Import Error</span>
                </div>
                <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                  <p className="text-red-800">{errorMessage}</p>
                </div>
                <button
                  onClick={() => {
                    setUploadStatus('idle')
                    setErrorMessage('')
                    setPreviewData([])
                  }}
                  className="px-4 py-2 text-white rounded-lg transition-colors"
                  style={{ backgroundColor: '#1955AE' }}
                >
                  Try Again
                </button>
                {getExpectedFormat()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
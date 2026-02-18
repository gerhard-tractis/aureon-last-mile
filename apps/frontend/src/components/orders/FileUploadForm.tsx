'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileIcon, Loader2, X } from 'lucide-react';

interface FileUploadFormProps {
  onFileSelected: (file: File) => void;
  isLoading: boolean;
  error?: string;
}

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_MIME_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

export default function FileUploadForm({ onFileSelected, isLoading, error }: FileUploadFormProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSelect = useCallback(
    (file: File) => {
      setFileError(null);

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        setFileError('File too large. Maximum 10MB.');
        return;
      }

      if (file.size === 0) {
        setFileError('File is empty.');
        return;
      }

      // Check extension
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        setFileError('Invalid file format. Please upload .csv, .xlsx, or .xls');
        return;
      }

      setSelectedFile(file);
      onFileSelected(file);
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        validateAndSelect(files[0]);
      }
    },
    [validateAndSelect]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    validateAndSelect(fileList[0]);
    e.target.value = '';
  };

  const clearFile = () => {
    setSelectedFile(null);
    setFileError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const displayError = fileError || error;

  return (
    <div className="space-y-4">
      <label
        className={`w-full flex flex-col items-center px-4 py-8 bg-white rounded-lg shadow-sm tracking-wide border-2 cursor-pointer transition-colors ${
          isDragging
            ? 'border-blue-500 border-dashed bg-blue-50'
            : displayError
              ? 'border-red-300 hover:border-red-400'
              : 'border-gray-300 hover:border-blue-400'
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="mt-2 text-sm text-gray-600">Parsing file...</span>
          </>
        ) : selectedFile ? (
          <div className="flex items-center gap-3">
            <FileIcon className="w-6 h-6 text-gray-500" />
            <div>
              <p className="text-sm font-medium text-gray-700">{selectedFile.name}</p>
              <p className="text-xs text-gray-500">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                clearFile();
              }}
              className="p-1 rounded-full hover:bg-gray-100"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 text-gray-400" />
            <span className="mt-2 text-sm text-gray-600">
              {isDragging
                ? 'Drop your file here'
                : 'Drag and drop or click to select a file'}
            </span>
            <span className="mt-1 text-xs text-gray-400">
              CSV, XLSX, or XLS (max 10MB)
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={ACCEPTED_MIME_TYPES.join(',')}
          onChange={handleInputChange}
          disabled={isLoading}
        />
      </label>

      {displayError && (
        <p className="text-sm text-red-600">{displayError}</p>
      )}
    </div>
  );
}

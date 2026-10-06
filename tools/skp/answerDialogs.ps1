# Spatial Archive: watches the SketchUp instance started by convert.js and answers the dialogs
# that would otherwise stop an unattended export (e.g. "File Version Warning" when a model was
# saved by a newer SketchUp). Only windows of that one process are touched. Every other dialog
# is written to the log, so a stalled conversion can say what SketchUp is waiting for.
param([int]$ProcessId, [string]$LogPath)

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$element = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$ofProcess = New-Object System.Windows.Automation.PropertyCondition($element::ProcessIdProperty, $ProcessId)
$isText = New-Object System.Windows.Automation.PropertyCondition($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)

# Dialog title -> the button that lets the export continue.
$answers = @{ 'File Version Warning' = 'OK' }
$logged = @{}

while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
  try {
    foreach ($window in $element::RootElement.FindAll($scope::Children, $ofProcess)) {
      $title = $window.Current.Name

      if ($title -like '* - SketchUp*') { continue }

      if ($answers.ContainsKey($title)) {
        $byName = New-Object System.Windows.Automation.PropertyCondition($element::NameProperty, $answers[$title])
        $button = $window.FindFirst($scope::Descendants, $byName)

        if ($button) {
          $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
          Add-Content -Path $LogPath -Value "answered: $title"
        }
      } elseif ($title -and -not $logged.ContainsKey($title)) {
        $texts = @($window.FindAll($scope::Descendants, $isText) | ForEach-Object { $_.Current.Name }) -join ' '
        Add-Content -Path $LogPath -Value "dialog: $title :: $texts"
        $logged[$title] = $true
      }
    }
  } catch {
    # Windows come and go while SketchUp starts; try again on the next pass.
  }

  Start-Sleep -Milliseconds 700
}

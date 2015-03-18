(define shenjs.repl-split-input-aux
  [] Acc Ret -> Ret
  [B | Bytes] Acc Ret -> (let Acc [B | Acc]
                              Buf (reverse Acc)
                              X (compile (function shen.<st_input>)
                                         Buf
                                         (/. E (fail)))
                           (shenjs.repl-split-input-aux
                             Bytes
                             Acc
                             (if (or (= X (fail)) (empty? X))
                                 Ret
                                 (@p Buf Bytes)))))

(define shenjs.repl-split-input
  Bytes -> (shenjs.repl-split-input-aux Bytes [] []))

(defun eval-kl (X)
  (trap-error (let . (set js.in-repl true)
                (let R (js.eval (js.from-kl (cons X ())))
                  (let . (set js.in-repl false)
                    R)))
              (lambda E (do (set js.in-repl false)
                            (error (error-to-string E))))))
